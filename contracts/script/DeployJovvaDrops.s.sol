// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {JovvaDrops} from "../src/JovvaDrops.sol";

interface DeployVm {
    function startBroadcast() external;
    function stopBroadcast() external;
}

contract DeployJovvaDrops {
    DeployVm constant vm =
        DeployVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run(address operator) external returns (JovvaDrops deployed) {
        require(block.chainid == 5042, "Arc mainnet only");
        require(operator != address(0), "Zero operator");
        vm.startBroadcast();
        deployed = new JovvaDrops(
            0x3600000000000000000000000000000000000000,
            operator
        );
        vm.stopBroadcast();
    }
}
