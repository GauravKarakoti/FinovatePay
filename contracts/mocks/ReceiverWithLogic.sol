// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";

contract ReceiverWithLogic is ERC721Holder {
    event Received(uint256 amount);

    receive() external payable {
        emit Received(msg.value);
    }
}
