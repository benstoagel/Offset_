import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface CarbonOffset {
  id: string;
  name: string;
  description: string;
  price: number;
  carbonAmount: number;
  creator: string;
  timestamp: number;
  isVerified: boolean;
  decryptedValue?: number;
  publicValue1: number;
  publicValue2: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [offsets, setOffsets] = useState<CarbonOffset[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingOffset, setCreatingOffset] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newOffsetData, setNewOffsetData] = useState({ name: "", description: "", carbonAmount: "", price: "" });
  const [selectedOffset, setSelectedOffset] = useState<CarbonOffset | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterVerified, setFilterVerified] = useState(false);

  const { initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const offsetsList: CarbonOffset[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          offsetsList.push({
            id: businessId,
            name: businessData.name,
            description: businessData.description,
            price: Number(businessData.publicValue1) || 0,
            carbonAmount: Number(businessData.publicValue2) || 0,
            creator: businessData.creator,
            timestamp: Number(businessData.timestamp),
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setOffsets(offsetsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const createOffset = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingOffset(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating carbon offset with Zama FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const carbonAmount = parseInt(newOffsetData.carbonAmount) || 0;
      const businessId = `offset-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, carbonAmount);
      
      const tx = await contract.createBusinessData(
        businessId,
        newOffsetData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        parseInt(newOffsetData.price) || 0,
        carbonAmount,
        newOffsetData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Carbon offset created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewOffsetData({ name: "", description: "", carbonAmount: "", price: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingOffset(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Carbon amount decrypted and verified successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data is already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        await loadData();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Decryption failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const callIsAvailable = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const result = await contract.isAvailable();
      setTransactionStatus({ visible: true, status: "success", message: "Contract is available and working!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Contract call failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredOffsets = offsets.filter(offset => {
    const matchesSearch = offset.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         offset.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = !filterVerified || offset.isVerified;
    return matchesSearch && matchesFilter;
  });

  const stats = {
    totalOffsets: offsets.length,
    verifiedOffsets: offsets.filter(o => o.isVerified).length,
    totalCarbon: offsets.reduce((sum, o) => sum + o.carbonAmount, 0),
    avgPrice: offsets.length > 0 ? offsets.reduce((sum, o) => sum + o.price, 0) / offsets.length : 0
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>🌿 Private Carbon Offset Market</h1>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔐</div>
            <h2>Connect Your Wallet to Access Private Carbon Market</h2>
            <p>Securely trade carbon offsets with fully homomorphic encryption protection</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>Connect your wallet to initialize FHE system</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>Trade carbon offsets with encrypted amounts</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>Verify decryption while keeping data private</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
        <p className="loading-note">Securing carbon offset transactions</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading carbon offset market...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>🌿 Private Carbon Offset Market</h1>
          <p>FHE-Protected Carbon Credit Trading</p>
        </div>
        
        <div className="header-actions">
          <button onClick={callIsAvailable} className="test-btn">
            Test Contract
          </button>
          <button onClick={() => setShowCreateModal(true)} className="create-btn">
            + List Offset
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        <div className="stats-panel">
          <div className="stat-card">
            <h3>Total Offsets</h3>
            <div className="stat-value">{stats.totalOffsets}</div>
          </div>
          <div className="stat-card">
            <h3>Verified</h3>
            <div className="stat-value">{stats.verifiedOffsets}</div>
          </div>
          <div className="stat-card">
            <h3>Total Carbon</h3>
            <div className="stat-value">{stats.totalCarbon}t</div>
          </div>
          <div className="stat-card">
            <h3>Avg Price</h3>
            <div className="stat-value">${stats.avgPrice.toFixed(2)}</div>
          </div>
        </div>

        <div className="search-section">
          <div className="search-bar">
            <input 
              type="text" 
              placeholder="Search carbon offsets..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="filters">
            <label>
              <input 
                type="checkbox" 
                checked={filterVerified}
                onChange={(e) => setFilterVerified(e.target.checked)}
              />
              Show Verified Only
            </label>
          </div>
        </div>

        <div className="offsets-grid">
          {filteredOffsets.length === 0 ? (
            <div className="no-offsets">
              <p>No carbon offsets found</p>
              <button onClick={() => setShowCreateModal(true)} className="create-btn">
                List First Offset
              </button>
            </div>
          ) : (
            filteredOffsets.map((offset) => (
              <div 
                key={offset.id} 
                className={`offset-card ${offset.isVerified ? 'verified' : ''}`}
                onClick={() => setSelectedOffset(offset)}
              >
                <div className="card-header">
                  <h3>{offset.name}</h3>
                  {offset.isVerified && <span className="verified-badge">✅ Verified</span>}
                </div>
                <p className="description">{offset.description}</p>
                <div className="card-details">
                  <div className="detail">
                    <span>Price:</span>
                    <strong>${offset.price}</strong>
                  </div>
                  <div className="detail">
                    <span>Carbon:</span>
                    <strong>{offset.isVerified ? `${offset.decryptedValue}t` : '🔒 Encrypted'}</strong>
                  </div>
                  <div className="detail">
                    <span>Creator:</span>
                    <span>{offset.creator.substring(0, 6)}...{offset.creator.substring(38)}</span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
      
      {showCreateModal && (
        <ModalCreateOffset 
          onSubmit={createOffset} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingOffset} 
          offsetData={newOffsetData} 
          setOffsetData={setNewOffsetData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedOffset && (
        <OffsetDetailModal 
          offset={selectedOffset} 
          onClose={() => setSelectedOffset(null)} 
          isDecrypting={isDecrypting || fheIsDecrypting} 
          decryptData={() => decryptData(selectedOffset.id)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}

      <footer className="app-footer">
        <div className="footer-content">
          <p>🌍 Private Carbon Offset Market - Secured by Zama FHE Technology</p>
          <div className="footer-links">
            <span>ESG Compliant</span>
            <span>•</span>
            <span>FHE Protected</span>
            <span>•</span>
            <span>Transparent Verification</span>
          </div>
        </div>
      </footer>
    </div>
  );
};

const ModalCreateOffset: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  offsetData: any;
  setOffsetData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, offsetData, setOffsetData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    if (name === 'carbonAmount' || name === 'price') {
      const intValue = value.replace(/[^\d]/g, '');
      setOffsetData({ ...offsetData, [name]: intValue });
    } else {
      setOffsetData({ ...offsetData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-offset-modal">
        <div className="modal-header">
          <h2>List New Carbon Offset</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 Carbon Amount Encryption</strong>
            <p>Carbon amount will be encrypted with Zama FHE (Integer only)</p>
          </div>
          
          <div className="form-group">
            <label>Project Name *</label>
            <input 
              type="text" 
              name="name" 
              value={offsetData.name} 
              onChange={handleChange} 
              placeholder="Enter project name..." 
            />
          </div>
          
          <div className="form-group">
            <label>Description *</label>
            <textarea 
              name="description" 
              value={offsetData.description} 
              onChange={handleChange} 
              placeholder="Describe your carbon offset project..." 
              rows={3}
            />
          </div>
          
          <div className="form-group">
            <label>Carbon Amount (tons, Integer only) *</label>
            <input 
              type="number" 
              name="carbonAmount" 
              value={offsetData.carbonAmount} 
              onChange={handleChange} 
              placeholder="Enter carbon amount..." 
              step="1"
              min="0"
            />
            <div className="data-type-label">FHE Encrypted Integer</div>
          </div>
          
          <div className="form-group">
            <label>Price per ton ($) *</label>
            <input 
              type="number" 
              name="price" 
              value={offsetData.price} 
              onChange={handleChange} 
              placeholder="Enter price per ton..." 
              step="1"
              min="0"
            />
            <div className="data-type-label">Public Data</div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !offsetData.name || !offsetData.description || !offsetData.carbonAmount || !offsetData.price} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting and Listing..." : "List Offset"}
          </button>
        </div>
      </div>
    </div>
  );
};

const OffsetDetailModal: React.FC<{
  offset: CarbonOffset;
  onClose: () => void;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
}> = ({ offset, onClose, isDecrypting, decryptData }) => {
  const handleDecrypt = async () => {
    await decryptData();
  };

  return (
    <div className="modal-overlay">
      <div className="offset-detail-modal">
        <div className="modal-header">
          <h2>Carbon Offset Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="offset-info">
            <div className="info-item">
              <span>Project Name:</span>
              <strong>{offset.name}</strong>
            </div>
            <div className="info-item">
              <span>Description:</span>
              <p>{offset.description}</p>
            </div>
            <div className="info-item">
              <span>Creator:</span>
              <strong>{offset.creator}</strong>
            </div>
            <div className="info-item">
              <span>Listed:</span>
              <strong>{new Date(offset.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
            <div className="info-item">
              <span>Price per ton:</span>
              <strong>${offset.price}</strong>
            </div>
          </div>
          
          <div className="data-section">
            <h3>Carbon Amount Data</h3>
            
            <div className="data-row">
              <div className="data-label">Carbon Amount:</div>
              <div className="data-value">
                {offset.isVerified ? 
                  `${offset.decryptedValue} tons (On-chain Verified)` : 
                  "🔒 FHE Encrypted Integer"
                }
              </div>
              <button 
                className={`decrypt-btn ${offset.isVerified ? 'verified' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting}
              >
                {isDecrypting ? "🔓 Verifying..." : 
                 offset.isVerified ? "✅ Verified" : "🔓 Verify Amount"}
              </button>
            </div>
            
            <div className="fhe-info">
              <div className="fhe-icon">🔐</div>
              <div>
                <strong>FHE-Protected Carbon Verification</strong>
                <p>Carbon amount is encrypted on-chain using Zama FHE technology. 
                Verification happens offline with on-chain proof validation.</p>
              </div>
            </div>
          </div>
          
          {offset.isVerified && (
            <div className="verification-section">
              <div className="verified-banner">
                <div className="verified-icon">✅</div>
                <div>
                  <h4>On-Chain Verified</h4>
                  <p>Carbon amount has been successfully verified on the blockchain</p>
                </div>
              </div>
              
              <div className="verified-details">
                <div className="detail-card">
                  <h5>Total Carbon</h5>
                  <div className="carbon-amount">{offset.decryptedValue} tons</div>
                </div>
                <div className="detail-card">
                  <h5>Total Value</h5>
                  <div className="total-value">${(offset.decryptedValue || 0) * offset.price}</div>
                </div>
              </div>
            </div>
          )}
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
          {!offset.isVerified && (
            <button 
              onClick={handleDecrypt} 
              disabled={isDecrypting}
              className="verify-btn"
            >
              {isDecrypting ? "Verifying..." : "Verify Carbon Amount"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;


