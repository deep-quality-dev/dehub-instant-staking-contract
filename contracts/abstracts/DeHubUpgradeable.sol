// SPDX-License-Identifier: MIT

pragma solidity ^0.8.9;

import "hardhat/console.sol";
import {IERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {SafeERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import {ContextUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol";
import {AddressUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/AddressUpgradeable.sol";
import {SafeMathUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/math/SafeMathUpgradeable.sol";

abstract contract DeHubUpgradeable is
  Initializable,
  OwnableUpgradeable,
  AccessControlUpgradeable,
  ReentrancyGuardUpgradeable,
  PausableUpgradeable,
  UUPSUpgradeable
{
  using SafeERC20Upgradeable for IERC20Upgradeable;
  using AddressUpgradeable for address;
  using SafeMathUpgradeable for uint256;

  uint256 public version;

  /// @custom:oz-upgrades-unsafe-allow constructor
  function initialize() public onlyInitializing {
    __Ownable_init();
    __AccessControl_init();
    __ReentrancyGuard_init();
    __Pausable_init();
    __UUPSUpgradeable_init();
    version = 1;
    console.log("v", version);
  }

  function _authorizeUpgrade(
    address newImplementation
  ) internal override onlyOwner {}
}
