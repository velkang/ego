// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {EgoDrops} from "../src/EgoDrops.sol";

interface DeployVm {
    function startBroadcast() external;
    function stopBroadcast() external;
}

contract DeployEgoDrops {
    DeployVm constant vm =
        DeployVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run(address operator) external returns (EgoDrops deployed) {
        require(block.chainid == 5042, "Arc mainnet only");
        require(operator != address(0), "Zero operator");
        vm.startBroadcast();
        deployed = new EgoDrops(
            0x3600000000000000000000000000000000000000,
            operator
        );
        vm.stopBroadcast();
    }
}
