// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// Stand-in for Agora AUSD: 6 decimals, anyone can mint. Used by the tests, and deployed to
/// Monad testnet as "tAUSD" while Agora's AUSD faucet there is empty (ignition/modules/FanoutTestAusd.ts).
contract MockAUSD is ERC20 {
    constructor() ERC20("Fanout Test AUSD", "tAUSD") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
