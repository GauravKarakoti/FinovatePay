// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";

contract RevertingReceiver is ERC721Holder {
    receive() external payable {
        revert("Cannot receive ETH");
    }
}
