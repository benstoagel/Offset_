pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract OffsetMarket is ZamaEthereumConfig {
    struct Certificate {
        euint32 encryptedAmount;
        uint256 publicIdentifier;
        address owner;
        uint256 creationTimestamp;
        uint256 expirationTimestamp;
        bool isRetired;
    }

    struct MarketListing {
        string projectId;
        uint256 availableCredits;
        uint256 pricePerCredit;
        address seller;
        bool isActive;
    }

    mapping(string => Certificate) public certificates;
    mapping(string => MarketListing) public marketListings;
    string[] public certificateIds;
    string[] public marketListingIds;

    event CertificateIssued(string indexed certificateId, address indexed owner);
    event CertificateRetired(string indexed certificateId, address indexed retier);
    event MarketListingCreated(string indexed listingId, address indexed seller);
    event MarketListingUpdated(string indexed listingId, uint256 newPrice);
    event MarketListingDeactivated(string indexed listingId);
    event CreditsPurchased(string indexed listingId, address indexed buyer, uint256 amount);

    constructor() ZamaEthereumConfig() {
    }

    function issueCertificate(
        string calldata certificateId,
        externalEuint32 encryptedAmount,
        bytes calldata inputProof,
        uint256 publicIdentifier,
        uint256 expirationTimestamp
    ) external {
        require(bytes(certificates[certificateId].owner).length == 0, "Certificate already exists");
        require(expirationTimestamp > block.timestamp, "Expiration must be in future");

        euint32 encrypted = FHE.fromExternal(encryptedAmount, inputProof);
        require(FHE.isInitialized(encrypted), "Invalid encrypted input");

        certificates[certificateId] = Certificate({
            encryptedAmount: encrypted,
            publicIdentifier: publicIdentifier,
            owner: msg.sender,
            creationTimestamp: block.timestamp,
            expirationTimestamp: expirationTimestamp,
            isRetired: false
        });

        FHE.allowThis(certificates[certificateId].encryptedAmount);
        FHE.makePubliclyDecryptable(certificates[certificateId].encryptedAmount);

        certificateIds.push(certificateId);
        emit CertificateIssued(certificateId, msg.sender);
    }

    function retireCertificate(
        string calldata certificateId,
        bytes memory abiEncodedClearValue,
        bytes memory decryptionProof
    ) external {
        require(bytes(certificates[certificateId].owner).length > 0, "Certificate does not exist");
        require(!certificates[certificateId].isRetired, "Certificate already retired");
        require(msg.sender == certificates[certificateId].owner, "Only owner can retire");
        require(block.timestamp < certificates[certificateId].expirationTimestamp, "Certificate expired");

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(certificates[certificateId].encryptedAmount);

        FHE.checkSignatures(cts, abiEncodedClearValue, decryptionProof);

        certificates[certificateId].isRetired = true;
        emit CertificateRetired(certificateId, msg.sender);
    }

    function createMarketListing(
        string calldata listingId,
        string calldata projectId,
        uint256 availableCredits,
        uint256 pricePerCredit
    ) external {
        require(bytes(marketListings[listingId].seller).length == 0, "Listing already exists");
        require(availableCredits > 0, "Must have available credits");
        require(pricePerCredit > 0, "Price must be positive");

        marketListings[listingId] = MarketListing({
            projectId: projectId,
            availableCredits: availableCredits,
            pricePerCredit: pricePerCredit,
            seller: msg.sender,
            isActive: true
        });

        marketListingIds.push(listingId);
        emit MarketListingCreated(listingId, msg.sender);
    }

    function updateMarketListing(
        string calldata listingId,
        uint256 newPrice
    ) external {
        require(bytes(marketListings[listingId].seller).length > 0, "Listing does not exist");
        require(msg.sender == marketListings[listingId].seller, "Only seller can update");
        require(newPrice > 0, "Price must be positive");

        marketListings[listingId].pricePerCredit = newPrice;
        emit MarketListingUpdated(listingId, newPrice);
    }

    function deactivateMarketListing(string calldata listingId) external {
        require(bytes(marketListings[listingId].seller).length > 0, "Listing does not exist");
        require(msg.sender == marketListings[listingId].seller, "Only seller can deactivate");
        require(marketListings[listingId].isActive, "Listing already inactive");

        marketListings[listingId].isActive = false;
        emit MarketListingDeactivated(listingId);
    }

    function purchaseCredits(
        string calldata listingId,
        uint256 amount
    ) external payable {
        require(bytes(marketListings[listingId].seller).length > 0, "Listing does not exist");
        require(marketListings[listingId].isActive, "Listing is inactive");
        require(amount > 0, "Amount must be positive");
        require(amount <= marketListings[listingId].availableCredits, "Insufficient credits");

        uint256 totalCost = amount * marketListings[listingId].pricePerCredit;
        require(msg.value >= totalCost, "Insufficient payment");

        marketListings[listingId].availableCredits -= amount;

        payable(marketListings[listingId].seller).transfer(totalCost);

        if (msg.value > totalCost) {
            payable(msg.sender).transfer(msg.value - totalCost);
        }

        emit CreditsPurchased(listingId, msg.sender, amount);
    }

    function getCertificate(string calldata certificateId) external view returns (
        euint32 encryptedAmount,
        uint256 publicIdentifier,
        address owner,
        uint256 creationTimestamp,
        uint256 expirationTimestamp,
        bool isRetired
    ) {
        require(bytes(certificates[certificateId].owner).length > 0, "Certificate does not exist");
        Certificate storage cert = certificates[certificateId];

        return (
            cert.encryptedAmount,
            cert.publicIdentifier,
            cert.owner,
            cert.creationTimestamp,
            cert.expirationTimestamp,
            cert.isRetired
        );
    }

    function getMarketListing(string calldata listingId) external view returns (
        string memory projectId,
        uint256 availableCredits,
        uint256 pricePerCredit,
        address seller,
        bool isActive
    ) {
        require(bytes(marketListings[listingId].seller).length > 0, "Listing does not exist");
        MarketListing storage listing = marketListings[listingId];

        return (
            listing.projectId,
            listing.availableCredits,
            listing.pricePerCredit,
            listing.seller,
            listing.isActive
        );
    }

    function getAllCertificateIds() external view returns (string[] memory) {
        return certificateIds;
    }

    function getAllMarketListingIds() external view returns (string[] memory) {
        return marketListingIds;
    }

    function isAvailable() public pure returns (bool) {
        return true;
    }
}


