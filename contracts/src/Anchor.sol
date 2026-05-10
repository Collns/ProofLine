// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title ProofLineAnchor
/// @notice Append-only registry of Merkle roots committing
///         ProofLine envelope state. Only the deployer can
///         anchor new roots.
contract ProofLineAnchor {
    event RootAnchored(
        bytes32 indexed root,
        uint256 indexed sequence,
        address indexed anchorer,
        uint256 timestamp
    );

    mapping(bytes32 => uint256) public rootToBlock;
    uint256 public latestSequence;
    address public immutable owner;

    error Unauthorized();
    error AlreadyAnchored();

    constructor() {
        owner = msg.sender;
    }

    function anchorRoot(bytes32 root) external {
        if (msg.sender != owner) revert Unauthorized();
        if (rootToBlock[root] != 0) revert AlreadyAnchored();
        latestSequence += 1;
        rootToBlock[root] = block.number;
        emit RootAnchored(root, latestSequence, msg.sender, block.timestamp);
    }

    function isAnchored(bytes32 root) external view returns (bool) {
        return rootToBlock[root] != 0;
    }
}
