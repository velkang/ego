// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {JovvaDrops} from "../src/JovvaDrops.sol";

interface TestVm {
    function warp(uint256) external;
    function prank(address) external;
    function expectRevert(bytes4) external;
}

contract MockUSDC {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    bool public fail;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address to, uint256 amount) external returns (bool) {
        allowance[msg.sender][to] = amount;
        return true;
    }

    function setFail(bool value) external {
        fail = value;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        if (fail) return false;
        require(balanceOf[msg.sender] >= amount);
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (fail) return false;
        require(allowance[from][msg.sender] >= amount && balanceOf[from] >= amount);
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract JovvaDropsTest {
    TestVm constant vm = TestVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    MockUSDC token;
    JovvaDrops drops;
    bytes32 constant EVENT = keccak256("event");
    bytes32 constant SPOT = keccak256("spot");
    bytes32 constant ACCOUNT = keccak256("account");
    address constant RECIPIENT = address(0xBEEF);

    function setUp() public {
        vm.warp(100000);
        token = new MockUSDC();
        drops = new JovvaDrops(address(token), address(this));
        token.mint(address(this), 100e6);
        token.approve(address(drops), type(uint256).max);
        create(EVENT, 2);
    }

    function create(bytes32 id, uint32 capacity) internal {
        bytes32[] memory ids = new bytes32[](1);
        ids[0] = SPOT;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1e6;
        uint32[] memory capacities = new uint32[](1);
        capacities[0] = capacity;
        drops.createEvent(id, 100000, 100100, ids, amounts, capacities);
    }

    function launch() internal {
        drops.fund(EVENT, 2e6);
        drops.activate(EVENT);
    }

    function testClaimPaysAndDecrements() public {
        launch();
        drops.claim(EVENT, SPOT, ACCOUNT, RECIPIENT);
        require(token.balanceOf(RECIPIENT) == 1e6);
        require(drops.hasClaimed(EVENT, ACCOUNT));
        (, uint32 remaining) = drops.spots(EVENT, SPOT);
        require(remaining == 1);
    }

    function testDuplicateAccountAcrossSpotsRejected() public {
        launch();
        drops.claim(EVENT, SPOT, ACCOUNT, RECIPIENT);
        vm.expectRevert(JovvaDrops.AlreadyClaimed.selector);
        drops.claim(EVENT, SPOT, ACCOUNT, address(123));
    }

    function testUnauthorizedPayoutRejected() public {
        launch();
        vm.prank(RECIPIENT);
        vm.expectRevert(JovvaDrops.Unauthorized.selector);
        drops.claim(EVENT, SPOT, ACCOUNT, RECIPIENT);
    }

    function testCannotActivateUnderfunded() public {
        drops.fund(EVENT, 1e6);
        vm.expectRevert(JovvaDrops.InvalidState.selector);
        drops.activate(EVENT);
    }

    function testCannotOverfundOrFundAfterActivation() public {
        vm.expectRevert(JovvaDrops.InvalidState.selector);
        drops.fund(EVENT, 3e6);
        launch();
        vm.expectRevert(JovvaDrops.InvalidState.selector);
        drops.fund(EVENT, 1);
    }

    function testExhaustedSpotRejected() public {
        launch();
        drops.claim(EVENT, SPOT, ACCOUNT, RECIPIENT);
        drops.claim(EVENT, SPOT, bytes32(uint256(2)), RECIPIENT);
        vm.expectRevert(JovvaDrops.Exhausted.selector);
        drops.claim(EVENT, SPOT, bytes32(uint256(3)), RECIPIENT);
    }

    function testPausedAndClosedRejectClaims() public {
        launch();
        drops.setPaused(EVENT, true);
        vm.expectRevert(JovvaDrops.InvalidState.selector);
        drops.claim(EVENT, SPOT, ACCOUNT, RECIPIENT);
        drops.setPaused(EVENT, false);
        drops.close(EVENT);
        vm.expectRevert(JovvaDrops.InvalidState.selector);
        drops.claim(EVENT, SPOT, ACCOUNT, RECIPIENT);
    }

    function testExpiryRejectsClaimAndRefunds() public {
        launch();
        vm.warp(100100);
        vm.expectRevert(JovvaDrops.InvalidState.selector);
        drops.claim(EVENT, SPOT, ACCOUNT, RECIPIENT);
        uint256 beforeBalance = token.balanceOf(address(this));
        drops.refund(EVENT);
        require(token.balanceOf(address(this)) == beforeBalance + 2e6);
        vm.expectRevert(JovvaDrops.InvalidState.selector);
        drops.refund(EVENT);
    }

    function testRefundOnlyUnusedFundsToFunder() public {
        launch();
        drops.claim(EVENT, SPOT, ACCOUNT, RECIPIENT);
        drops.close(EVENT);
        uint256 beforeBalance = token.balanceOf(address(this));
        drops.refund(EVENT);
        require(token.balanceOf(address(this)) == beforeBalance + 1e6);
        require(token.balanceOf(RECIPIENT) == 1e6);
    }

    function testTransferFailureRollsBackClaim() public {
        launch();
        token.setFail(true);
        vm.expectRevert(JovvaDrops.TransferFailed.selector);
        drops.claim(EVENT, SPOT, ACCOUNT, RECIPIENT);
        require(!drops.hasClaimed(EVENT, ACCOUNT));
        (, uint32 remaining) = drops.spots(EVENT, SPOT);
        require(remaining == 2);
    }

    function testEventsHaveIsolatedAccounting() public {
        launch();
        bytes32 second = keccak256("second");
        create(second, 1);
        drops.fund(second, 1e6);
        drops.activate(second);
        drops.claim(second, SPOT, ACCOUNT, RECIPIENT);
        drops.close(EVENT);
        drops.refund(EVENT);
        require(token.balanceOf(RECIPIENT) == 1e6);
        require(drops.hasClaimed(second, ACCOUNT));
        require(!drops.hasClaimed(EVENT, ACCOUNT));
    }

    function testDuplicateConfigurationRejected() public {
        vm.expectRevert(JovvaDrops.InvalidConfiguration.selector);
        create(EVENT, 1);
    }

    function testFuzzConservation(uint8 claimCount) public {
        launch();
        uint256 count = uint256(claimCount) % 3;
        for (uint256 i; i < count; i++) {
            drops.claim(EVENT, SPOT, bytes32(i + 1), RECIPIENT);
        }
        drops.close(EVENT);
        if (count < 2) drops.refund(EVENT);
        require(token.balanceOf(address(drops)) == 0);
        require(token.balanceOf(RECIPIENT) == count * 1e6);
        require(token.balanceOf(address(this)) + token.balanceOf(RECIPIENT) == 100e6);
    }

    function creatorCampaign(bool single) internal returns (bytes32 id, bytes32 second, address creator) {
        id = keccak256("creator-campaign"); second = keccak256("second"); creator = address(0xCAFE);
        bytes32[] memory ids = new bytes32[](2); ids[0] = SPOT; ids[1] = second;
        uint256[] memory amounts = new uint256[](2); amounts[0] = 1e6; amounts[1] = 2e6;
        uint32[] memory capacities = new uint32[](2); capacities[0] = 2; capacities[1] = 1;
        drops.createCampaign(id,100000,100100,ids,amounts,capacities,creator,single);
        token.mint(creator,4e6); vm.prank(creator); token.approve(address(drops),4e6);
    }
    function testCreatorFundsAndReceivesUnusedRefund() public {
        (bytes32 id,,address creator) = creatorCampaign(false);
        vm.prank(creator); drops.fund(id,4e6); drops.activate(id);
        drops.claim(id,SPOT,ACCOUNT,RECIPIENT); drops.close(id); drops.refund(id);
        require(token.balanceOf(creator) == 3e6);
        require(token.balanceOf(RECIPIENT) == 1e6);
    }
    function testOnlyRecordedCreatorCanFund() public {
        (bytes32 id,,) = creatorCampaign(false);
        vm.expectRevert(JovvaDrops.Unauthorized.selector); drops.fund(id,4e6);
        vm.prank(address(0xBAD)); vm.expectRevert(JovvaDrops.Unauthorized.selector); drops.fund(id,4e6);
    }
    function testMultipleDistinctDropsButNeverDuplicateDrop() public {
        (bytes32 id,bytes32 second,address creator) = creatorCampaign(false);
        vm.prank(creator); drops.fund(id,4e6); drops.activate(id);
        drops.claim(id,SPOT,ACCOUNT,RECIPIENT); drops.claim(id,second,ACCOUNT,RECIPIENT);
        vm.expectRevert(JovvaDrops.AlreadyClaimed.selector); drops.claim(id,SPOT,ACCOUNT,RECIPIENT);
        require(token.balanceOf(RECIPIENT) == 3e6);
        require(drops.claimedDrop(id,SPOT,ACCOUNT));
    }
    function testCreatorSingleRewardPolicyOnchain() public {
        (bytes32 id,bytes32 second,address creator) = creatorCampaign(true);
        vm.prank(creator); drops.fund(id,4e6); drops.activate(id);
        drops.claim(id,SPOT,ACCOUNT,RECIPIENT);
        vm.expectRevert(JovvaDrops.AlreadyClaimed.selector); drops.claim(id,second,ACCOUNT,RECIPIENT);
    }
}
