// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/Anchor.sol";

contract AnchorTest is Test {
    ProofLineAnchor anchor;
    address attacker = address(0xBAD);

    event RootAnchored(
        bytes32 indexed root,
        uint256 indexed sequence,
        address indexed anchorer,
        uint256 timestamp
    );

    function setUp() public {
        anchor = new ProofLineAnchor();
    }

    function test_OwnerSetInConstructor() public {
        assertEq(anchor.owner(), address(this));
    }

    function test_AnchorRoot_StoresRootToBlock() public {
        bytes32 root = keccak256("test-root-1");
        anchor.anchorRoot(root);
        assertGt(anchor.rootToBlock(root), 0);
    }

    function test_AnchorRoot_IncrementsSequence() public {
        assertEq(anchor.latestSequence(), 0);
        anchor.anchorRoot(keccak256("a"));
        assertEq(anchor.latestSequence(), 1);
        anchor.anchorRoot(keccak256("b"));
        assertEq(anchor.latestSequence(), 2);
    }

    function test_AnchorRoot_EmitsRootAnchoredEvent() public {
        bytes32 root = keccak256("test-event");
        vm.expectEmit(true, true, true, true);
        emit RootAnchored(root, 1, address(this), block.timestamp);
        anchor.anchorRoot(root);
    }

    function test_AnchorRoot_RevertsOnDuplicate() public {
        bytes32 root = keccak256("dup");
        anchor.anchorRoot(root);
        vm.expectRevert(ProofLineAnchor.AlreadyAnchored.selector);
        anchor.anchorRoot(root);
    }

    function test_AnchorRoot_RevertsForNonOwner() public {
        bytes32 root = keccak256("attacker");
        vm.prank(attacker);
        vm.expectRevert(ProofLineAnchor.Unauthorized.selector);
        anchor.anchorRoot(root);
    }

    function test_IsAnchored_FalseForUnknownRoot() public view {
        assertFalse(anchor.isAnchored(keccak256("never-anchored")));
    }

    function test_IsAnchored_TrueForAnchoredRoot() public {
        bytes32 root = keccak256("known");
        anchor.anchorRoot(root);
        assertTrue(anchor.isAnchored(root));
    }

    function test_MultipleDistinctRoots_IndependentBlocks() public {
        bytes32 r1 = keccak256("r1");
        bytes32 r2 = keccak256("r2");
        bytes32 r3 = keccak256("r3");

        anchor.anchorRoot(r1);
        uint256 b1 = anchor.rootToBlock(r1);

        vm.roll(block.number + 5);
        anchor.anchorRoot(r2);
        uint256 b2 = anchor.rootToBlock(r2);

        vm.roll(block.number + 3);
        anchor.anchorRoot(r3);
        uint256 b3 = anchor.rootToBlock(r3);

        assertEq(b2, b1 + 5);
        assertEq(b3, b2 + 3);
        assertEq(anchor.latestSequence(), 3);
    }
}
