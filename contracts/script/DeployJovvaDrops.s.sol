// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {JovvaDrops} from "../src/JovvaDrops.sol";

interface DeployVm {
    function envAddress(string calldata) external returns (address);
    function startBroadcast() external;
    function stopBroadcast() external;
}

contract DeployJovvaDrops {
    DeployVm constant vm = DeployVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external returns (JovvaDrops deployed) {
        address operator = vm.envAddress("JOVVA_OPERATOR_ADDRESS");
        vm.startBroadcast();
        deployed = new JovvaDrops(0x3600000000000000000000000000000000000000, operator);
        vm.stopBroadcast();
    }
}
