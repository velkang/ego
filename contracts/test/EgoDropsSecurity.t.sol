// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {EgoDrops} from "../src/EgoDrops.sol";
import {MockUSDC} from "./EgoDrops.t.sol";

interface ISecurityVm {
    struct Log {
        bytes32[] topics;
        bytes data;
        address emitter;
    }
    function warp(uint256) external;
    function expectRevert(bytes4) external;
    function recordLogs() external;
    function getRecordedLogs() external returns (Log[] memory);
}

contract CallbackUSDC is MockUSDC {
    address public callback;
    event Transfer(address indexed from, address indexed to, uint256 amount);

    function setCallback(address target) external {
        callback = target;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        if (callback != address(0)) {
            (bool ok,) = callback.call(abi.encodeWithSignature("attemptReentry()"));
            require(ok, "Callback assertion failed");
        }
        bool success = super.transfer(to, amount);
        // Intentionally adversarial token: emits only after the callback to test escrow ordering.
        // forge-lint: disable-next-line(reentrancy-events)
        if (success) emit Transfer(msg.sender, to, amount);
        return success;
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        if (callback != address(0)) {
            (bool ok,) = callback.call(abi.encodeWithSignature("attemptReentry()"));
            require(ok, "Callback assertion failed");
        }
        bool success = super.transferFrom(from, to, amount);
        // Intentionally adversarial token: emits only after the callback to test escrow ordering.
        // forge-lint: disable-next-line(reentrancy-events)
        if (success) emit Transfer(from, to, amount);
        return success;
    }
}

contract EgoDropsSecurityTest {
    ISecurityVm constant VM = ISecurityVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    CallbackUSDC token;
    EgoDrops drops;
    bytes32 constant EVENT = keccak256("security-event");
    bytes32 constant SPOT = keccak256("spot");
    bytes32 constant ACCOUNT = keccak256("account");
    address constant RECIPIENT = address(0xBEEF);
    uint256 callbacks;

    function setUp() public {
        VM.warp(100_000);
        token = new CallbackUSDC();
        drops = new EgoDrops(address(token), address(this));
        token.mint(address(this), 10e6);
        require(token.approve(address(drops), type(uint256).max));
        (bytes32[] memory ids, uint256[] memory amounts, uint32[] memory capacities) = configuration();
        drops.createEvent(EVENT, 100_010, 100_100, ids, amounts, capacities);
    }

    function configuration()
        internal
        pure
        returns (bytes32[] memory ids, uint256[] memory amounts, uint32[] memory capacities)
    {
        ids = new bytes32[](1);
        ids[0] = SPOT;
        amounts = new uint256[](1);
        amounts[0] = 1e6;
        capacities = new uint32[](1);
        capacities[0] = 2;
    }

    function launch() internal {
        drops.fund(EVENT, 2e6);
        drops.activate(EVENT);
    }

    // The callback forwards as the authorized operator/funder, so authorization
    // alone cannot explain a rejection. Every mutating entry point must be locked.
    function attemptReentry() external {
        require(msg.sender == address(token));
        callbacks++;
        (bytes32[] memory ids, uint256[] memory amounts, uint32[] memory capacities) = configuration();
        reject(
            abi.encodeCall(
                drops.createEvent,
                (keccak256("nested-event"), uint64(100_010), uint64(100_100), ids, amounts, capacities)
            )
        );
        reject(
            abi.encodeCall(
                drops.createCampaign,
                (
                    keccak256("nested-campaign"),
                    uint64(100_010),
                    uint64(100_100),
                    ids,
                    amounts,
                    capacities,
                    address(this),
                    false
                )
            )
        );
        reject(abi.encodeCall(drops.fund, (EVENT, 1)));
        reject(abi.encodeCall(drops.activate, (EVENT)));
        reject(abi.encodeCall(drops.setPaused, (EVENT, true)));
        reject(abi.encodeCall(drops.close, (EVENT)));
        reject(abi.encodeCall(drops.refund, (EVENT)));
        reject(abi.encodeCall(drops.claim, (EVENT, SPOT, bytes32(uint256(2)), RECIPIENT)));
    }

    function reject(bytes memory data) internal {
        (bool success, bytes memory result) = address(drops).call(data);
        require(
            !success && result.length == 4 && bytes4(result) == EgoDrops.InvalidState.selector,
            "Reentry not blocked by lock"
        );
    }

    function testFundingBlocksAllReentryAndEmitsBeforeToken() public {
        token.setCallback(address(this));
        VM.recordLogs();
        drops.fund(EVENT, 2e6);
        assertLogOrder(keccak256("Funded(bytes32,uint256)"));
        require(callbacks == 1);
        (,,, uint256 remaining,, bool active, bool paused, bool closed) = drops.events(EVENT);
        require(remaining == 2e6 && !active && !paused && !closed);
        require(token.balanceOf(address(drops)) == 2e6);
    }

    function testClaimBlocksAllReentryAndEmitsBeforeToken() public {
        launch();
        VM.warp(100_010);
        token.setCallback(address(this));
        VM.recordLogs();
        drops.claim(EVENT, SPOT, ACCOUNT, RECIPIENT);
        assertLogOrder(keccak256("Claimed(bytes32,bytes32,bytes32,address,uint256)"));
        require(callbacks == 1 && token.balanceOf(RECIPIENT) == 1e6);
        require(!drops.hasClaimed(EVENT, bytes32(uint256(2))));
        (, uint32 remaining) = drops.spots(EVENT, SPOT);
        require(remaining == 1);
    }

    function testRefundBlocksAllReentryAndEmitsBeforeToken() public {
        launch();
        drops.close(EVENT);
        token.setCallback(address(this));
        VM.recordLogs();
        drops.refund(EVENT);
        assertLogOrder(keccak256("Refunded(bytes32,address,uint256)"));
        require(callbacks == 1 && token.balanceOf(address(this)) == 10e6);
        (,,, uint256 remaining,,,, bool closed) = drops.events(EVENT);
        require(remaining == 0 && closed);
    }

    function assertLogOrder(bytes32 topic) internal {
        ISecurityVm.Log[] memory logs = VM.getRecordedLogs();
        require(logs.length == 2);
        require(logs[0].emitter == address(drops) && logs[0].topics[0] == topic);
        require(
            logs[1].emitter == address(token) && logs[1].topics[0] == keccak256("Transfer(address,address,uint256)")
        );
    }

    function testClaimStartAndEndBoundaries() public {
        launch();
        VM.warp(100_009);
        VM.expectRevert(EgoDrops.InvalidState.selector);
        drops.claim(EVENT, SPOT, ACCOUNT, RECIPIENT);
        VM.warp(100_010);
        drops.claim(EVENT, SPOT, ACCOUNT, RECIPIENT);
        VM.warp(100_099);
        drops.claim(EVENT, SPOT, bytes32(uint256(2)), RECIPIENT);
        VM.warp(100_100);
        VM.expectRevert(EgoDrops.InvalidState.selector);
        drops.claim(EVENT, SPOT, bytes32(uint256(3)), RECIPIENT);
    }

    function testRefundStartsExactlyAtExpiry() public {
        launch();
        VM.warp(100_099);
        VM.expectRevert(EgoDrops.InvalidState.selector);
        drops.refund(EVENT);
        VM.warp(100_100);
        drops.refund(EVENT);
        require(token.balanceOf(address(this)) == 10e6);
    }

    function testFundingRejectedExactlyAtExpiry() public {
        VM.warp(100_100);
        VM.expectRevert(EgoDrops.InvalidState.selector);
        drops.fund(EVENT, 2e6);
    }

    function testActivationRejectedExactlyAtExpiry() public {
        drops.fund(EVENT, 2e6);
        VM.warp(100_100);
        VM.expectRevert(EgoDrops.InvalidState.selector);
        drops.activate(EVENT);
    }

    function testCreationRejectedExactlyAtExpiry() public {
        (bytes32[] memory ids, uint256[] memory amounts, uint32[] memory capacities) = configuration();
        VM.warp(100_100);
        VM.expectRevert(EgoDrops.InvalidConfiguration.selector);
        drops.createEvent(keccak256("expired"), 100_010, 100_100, ids, amounts, capacities);
    }

    function testTransferFailureFundingRollsBackAndUnlocks() public {
        token.setFail(true);
        VM.expectRevert(EgoDrops.TransferFailed.selector);
        drops.fund(EVENT, 2e6);
        (,,, uint256 remaining,,,,) = drops.events(EVENT);
        require(remaining == 0);
        token.setFail(false);
        drops.fund(EVENT, 2e6);
        require(token.balanceOf(address(drops)) == 2e6);
    }

    function testTransferFailureRefundRollsBackClosureAndUnlocks() public {
        launch();
        VM.warp(100_100);
        token.setFail(true);
        VM.expectRevert(EgoDrops.TransferFailed.selector);
        drops.refund(EVENT);
        (,,, uint256 remaining,,,, bool closed) = drops.events(EVENT);
        require(remaining == 2e6 && !closed);
        token.setFail(false);
        drops.refund(EVENT);
        require(token.balanceOf(address(this)) == 10e6);
    }

    function testTransferFailureClaimUnlocksForRetry() public {
        launch();
        VM.warp(100_010);
        token.setFail(true);
        VM.expectRevert(EgoDrops.TransferFailed.selector);
        drops.claim(EVENT, SPOT, ACCOUNT, RECIPIENT);
        require(!drops.claimedDrop(EVENT, SPOT, ACCOUNT));
        token.setFail(false);
        drops.claim(EVENT, SPOT, ACCOUNT, RECIPIENT);
        require(token.balanceOf(RECIPIENT) == 1e6);
    }
}
