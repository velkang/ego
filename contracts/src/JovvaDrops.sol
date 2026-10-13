// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IERC20 {
    function transfer(address recipient, uint256 amount) external returns (bool);
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
}

/// @notice Team-operated event escrow. Location eligibility is checked offchain.
contract JovvaDrops {
    IERC20 public immutable usdc;
    address public immutable operator;

    struct Event {
        uint64 startsAt;
        uint64 endsAt;
        uint256 required;
        uint256 remaining;
        address funder;
        bool active;
        bool paused;
        bool closed;
    }

    struct Spot {
        uint256 amount;
        uint32 remaining;
    }
    mapping(bytes32 => Event) public events;
    mapping(bytes32 => mapping(bytes32 => Spot)) public spots;
    mapping(bytes32 => mapping(bytes32 => bool)) public hasClaimed;
    bool private entered;
    error Unauthorized();
    error InvalidConfiguration();
    error InvalidState();
    error AlreadyClaimed();
    error Exhausted();
    error TransferFailed();
    event EventCreated(bytes32 indexed id, uint256 required);
    event Funded(bytes32 indexed id, uint256 amount);
    event Activated(bytes32 indexed id);
    event Paused(bytes32 indexed id, bool paused);
    event Closed(bytes32 indexed id);
    event Refunded(bytes32 indexed id, address recipient, uint256 amount);
    event Claimed(
        bytes32 indexed eventId, bytes32 indexed spotId, bytes32 indexed accountId, address recipient, uint256 amount
    );
    modifier onlyOperator() {
        if (msg.sender != operator) revert Unauthorized();
        _;
    }
    modifier nonReentrant() {
        if (entered) revert InvalidState();
        entered = true;
        _;
        entered = false;
    }

    constructor(address token, address operator_) {
        if (token == address(0) || operator_ == address(0)) revert InvalidConfiguration();
        usdc = IERC20(token);
        operator = operator_;
    }

    function createEvent(
        bytes32 id,
        uint64 startsAt,
        uint64 endsAt,
        bytes32[] calldata spotIds,
        uint256[] calldata amounts,
        uint32[] calldata capacities
    ) external onlyOperator {
        if (
            id == bytes32(0) || events[id].endsAt != 0 || endsAt <= startsAt || endsAt <= block.timestamp
                || spotIds.length == 0 || spotIds.length > 100 || amounts.length != spotIds.length
                || capacities.length != spotIds.length
        ) revert InvalidConfiguration();
        uint256 required;
        for (uint256 i; i < spotIds.length; ++i) {
            if (spotIds[i] == bytes32(0) || amounts[i] == 0 || capacities[i] == 0 || spots[id][spotIds[i]].amount != 0) revert InvalidConfiguration();
            spots[id][spotIds[i]] = Spot(amounts[i], capacities[i]);
            required += amounts[i] * capacities[i];
        }
        events[id] = Event(startsAt, endsAt, required, 0, msg.sender, false, false, false);
        emit EventCreated(id, required);
    }

    function fund(bytes32 id, uint256 amount) external onlyOperator nonReentrant {
        Event storage e = events[id];
        if (
            e.endsAt == 0 || e.active || e.closed || block.timestamp >= e.endsAt || amount == 0
                || e.remaining + amount > e.required
        ) revert InvalidState();
        e.remaining += amount;
        if (!usdc.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
        emit Funded(id, amount);
    }

    function activate(bytes32 id) external onlyOperator {
        Event storage e = events[id];
        if (e.endsAt == 0 || e.active || e.closed || block.timestamp >= e.endsAt || e.remaining != e.required) {
            revert InvalidState();
        }
        e.active = true;
        emit Activated(id);
    }

    function setPaused(bytes32 id, bool paused) external onlyOperator {
        Event storage e = events[id];
        if (!e.active || e.closed) revert InvalidState();
        e.paused = paused;
        emit Paused(id, paused);
    }

    function close(bytes32 id) external onlyOperator {
        Event storage e = events[id];
        if (e.endsAt == 0 || e.closed) revert InvalidState();
        e.closed = true;
        emit Closed(id);
    }

    function refund(bytes32 id) external onlyOperator nonReentrant {
        Event storage e = events[id];
        if (e.endsAt == 0 || (!e.closed && block.timestamp < e.endsAt) || e.remaining == 0) revert InvalidState();
        e.closed = true;
        uint256 amount = e.remaining;
        e.remaining = 0;
        if (!usdc.transfer(e.funder, amount)) revert TransferFailed();
        emit Refunded(id, e.funder, amount);
    }

    function claim(bytes32 eventId, bytes32 spotId, bytes32 accountId, address recipient)
        external
        onlyOperator
        nonReentrant
    {
        Event storage e = events[eventId];
        Spot storage s = spots[eventId][spotId];
        if (
            !e.active || e.paused || e.closed || block.timestamp < e.startsAt || block.timestamp >= e.endsAt
                || recipient == address(0) || accountId == bytes32(0)
        ) revert InvalidState();
        if (hasClaimed[eventId][accountId]) revert AlreadyClaimed();
        if (s.remaining == 0 || s.amount == 0 || e.remaining < s.amount) revert Exhausted();
        hasClaimed[eventId][accountId] = true;
        s.remaining--;
        e.remaining -= s.amount;
        if (!usdc.transfer(recipient, s.amount)) revert TransferFailed();
        emit Claimed(eventId, spotId, accountId, recipient, s.amount);
    }
}
