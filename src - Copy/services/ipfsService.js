const { create } = require('ipfs-http-client');
const fs = require('fs');
const path = require('path');

/**
 * Service for uploading files to IPFS using Pinata or Web3.Storage
 */
class IpfsService {
  constructor(config) {
    this.config = config;
    this.provider = config.ipfs?.provider || 'pinata'; // Default to Pinata
    
    // Initialize IPFS client
    if (this.provider === 'local') {
      this.client = create({
        host: config.ipfs?.host || 'localhost',
        port: config.ipfs?.port || 5001,
        protocol: config.ipfs?.protocol || 'http'
      });
    }
    
    // Pinata configuration
    this.pinataConfig = {
      pinataApiKey: config.pinata?.apiKey || process.env.PINATA_API_KEY,
      pinataSecretApiKey: config.pinata?.secretApiKey || process.env.PINATA_SECRET_KEY,
      pinataGateway: config.pinata?.gateway || 'https://gateway.pinata.cloud'
    };
    
    // Web3.Storage configuration
    this.web3StorageConfig = {
      token: config.web3Storage?.token || process.env.WEB3_STORAGE_TOKEN,
      endpoint: config.web3Storage?.endpoint || 'https://api.web3.storage'
    };
  }

  /**
   * Upload PDF buffer to IPFS
   * @param {Buffer} pdfBuffer - PDF file buffer
   * @param {string} leaseId - Lease ID for naming
   * @returns {Promise<string>} IPFS CID
   */
  async uploadPdf(pdfBuffer, leaseId) {
    try {
      console.log(`[IpfsService] Uploading PDF for lease ${leaseId} using ${this.provider} provider`);
      
      let cid;
      
      switch (this.provider) {
        case 'pinata':
          cid = await this.uploadToPinata(pdfBuffer, leaseId);
          break;
        case 'web3storage':
          cid = await this.uploadToWeb3Storage(pdfBuffer, leaseId);
          break;
        case 'local':
          cid = await this.uploadToLocalIpfs(pdfBuffer, leaseId);
          break;
        default:
          throw new Error(`Unsupported IPFS provider: ${this.provider}`);
      }
      
      console.log(`[IpfsService] Successfully uploaded PDF to IPFS. CID: ${cid}`);
      return cid;
    } catch (error) {
      console.error('[IpfsService] Error uploading to IPFS:', error);
      throw new Error(`IPFS upload failed: ${error.message}`);
    }
  }

  /**
   * Upload to Pinata
   * @param {Buffer} pdfBuffer - PDF buffer
   * @param {string} leaseId - Lease ID
   * @returns {Promise<string>} IPFS CID
   */
  async uploadToPinata(pdfBuffer, leaseId) {
    if (!this.pinataConfig.pinataApiKey || !this.pinataConfig.pinataSecretApiKey) {
      throw new Error('Pinata API credentials not configured');
    }

    const FormData = require('form-data');
    const axios = require('axios');

    const form = new FormData();
    form.append('file', pdfBuffer, {
      filename: `lease-agreement-${leaseId}.pdf`,
      contentType: 'application/pdf'
    });

    // Pinata metadata
    const metadata = {
      name: `Lease Agreement - ${leaseId}`,
      keyvalues: {
        leaseId: leaseId,
        type: 'lease-agreement',
        generatedAt: new Date().toISOString(),
        version: '1.0'
      }
    };

    form.append('pinataMetadata', JSON.stringify(metadata));

    // Pinata options for pinning
    const pinataOptions = {
      cidVersion: 1,
      wrapWithDirectory: false
    };

    form.append('pinataOptions', JSON.stringify(pinataOptions));

    const response = await axios.post('https://api.pinata.cloud/pinning/pinFileToIPFS', form, {
      maxContentLength: 'Infinity',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${form.getBoundary()}`,
        'pinata_api_key': this.pinataConfig.pinataApiKey,
        'pinata_secret_api_key': this.pinataConfig.pinataSecretApiKey
      }
    });

    if (response.status !== 200) {
      throw new Error(`Pinata upload failed with status: ${response.status}`);
    }

    return response.data.IpfsHash;
  }

  /**
   * Upload to Web3.Storage
   * @param {Buffer} pdfBuffer - PDF buffer
   * @param {string} leaseId - Lease ID
   * @returns {Promise<string>} IPFS CID
   */
  async uploadToWeb3Storage(pdfBuffer, leaseId) {
    if (!this.web3StorageConfig.token) {
      throw new Error('Web3.Storage token not configured');
    }

    const axios = require('axios');

    // Create a File object
    const file = new Blob([pdfBuffer], { type: 'application/pdf' });
    const formData = new FormData();
    formData.append('file', file, `lease-agreement-${leaseId}.pdf`);

    try {
      const response = await axios.post(`${this.web3StorageConfig.endpoint}/upload`, formData, {
        headers: {
          'Authorization': `Bearer ${this.web3StorageConfig.token}`,
          'Content-Type': 'multipart/form-data'
        }
      });

      if (response.status !== 200) {
        throw new Error(`Web3.Storage upload failed with status: ${response.status}`);
      }

      // Web3.Storage returns the CID directly
      return response.data.cid;
    } catch (error) {
      // Fallback: try using the Web3.Storage client library if available
      return await this.uploadToWeb3StorageClient(pdfBuffer, leaseId);
    }
  }

  /**
   * Upload using Web3.Storage client library (fallback)
   * @param {Buffer} pdfBuffer - PDF buffer
   * @param {string} leaseId - Lease ID
   * @returns {Promise<string>} IPFS CID
   */
  async uploadToWeb3StorageClient(pdfBuffer, leaseId) {
    try {
      // Try to use the Web3.Storage client if available
      const { Web3Storage } = require('web3.storage');
      const client = new Web3Storage({ token: this.web3StorageConfig.token });

      const file = new File([pdfBuffer], `lease-agreement-${leaseId}.pdf`, {
        type: 'application/pdf'
      });

      const cid = await client.put([file], {
        name: `Lease Agreement - ${leaseId}`,
        wrapWithDirectory: false
      });

      return cid;
    } catch (error) {
      throw new Error(`Web3.Storage client upload failed: ${error.message}`);
    }
  }

  /**
   * Upload to local IPFS node
   * @param {Buffer} pdfBuffer - PDF buffer
   * @param {string} leaseId - Lease ID
   * @returns {Promise<string>} IPFS CID
   */
  async uploadToLocalIpfs(pdfBuffer, leaseId) {
    if (!this.client) {
      throw new Error('Local IPFS client not initialized');
    }

    try {
      const { cid } = await this.client.add(pdfBuffer, {
        pin: true, // Pin the file
        progress: (bytes) => {
          console.log(`[IpfsService] Upload progress: ${bytes} bytes`);
        }
      });

      return cid.toString();
    } catch (error) {
      throw new Error(`Local IPFS upload failed: ${error.message}`);
    }
  }

  /**
   * Get file from IPFS
   * @param {string} cid - IPFS CID
   * @returns {Promise<Buffer>} File buffer
   */
  async getFile(cid) {
    try {
      console.log(`[IpfsService] Retrieving file with CID: ${cid}`);
      
      let buffer;
      
      switch (this.provider) {
        case 'local':
          buffer = await this.getFromLocalIpfs(cid);
          break;
        case 'pinata':
          buffer = await this.getFromPinata(cid);
          break;
        case 'web3storage':
          buffer = await this.getFromWeb3Storage(cid);
          break;
        default:
          throw new Error(`Unsupported IPFS provider: ${this.provider}`);
      }
      
      console.log(`[IpfsService] Successfully retrieved file: ${buffer.length} bytes`);
      return buffer;
    } catch (error) {
      console.error('[IpfsService] Error retrieving file from IPFS:', error);
      throw new Error(`IPFS retrieval failed: ${error.message}`);
    }
  }

  /**
   * Get file from local IPFS node
   * @param {string} cid - IPFS CID
   * @returns {Promise<Buffer>} File buffer
   */
  async getFromLocalIpfs(cid) {
    if (!this.client) {
      throw new Error('Local IPFS client not initialized');
    }

    const chunks = [];
    for await (const chunk of this.client.cat(cid)) {
      chunks.push(chunk);
    }
    
    return Buffer.concat(chunks);
  }

  /**
   * Get file from Pinata gateway
   * @param {string} cid - IPFS CID
   * @returns {Promise<Buffer>} File buffer
   */
  async getFromPinata(cid) {
    const axios = require('axios');
    const url = `${this.pinataConfig.pinataGateway}/ipfs/${cid}`;
    
    const response = await axios.get(url, {
      responseType: 'arraybuffer'
    });
    
    return Buffer.from(response.data);
  }

  /**
   * Get file from Web3.Storage gateway
   * @param {string} cid - IPFS CID
   * @returns {Promise<Buffer>} File buffer
   */
  async getFromWeb3Storage(cid) {
    const axios = require('axios');
    const url = `https://ipfs.io/ipfs/${cid}`; // Using public IPFS gateway
    
    const response = await axios.get(url, {
      responseType: 'arraybuffer'
    });
    
    return Buffer.from(response.data);
  }

  /**
   * Get IPFS gateway URL for a CID
   * @param {string} cid - IPFS CID
   * @returns {string} Gateway URL
   */
  getGatewayUrl(cid) {
    switch (this.provider) {
      case 'pinata':
        return `${this.pinataConfig.pinataGateway}/ipfs/${cid}`;
      case 'web3storage':
        return `https://ipfs.io/ipfs/${cid}`;
      case 'local':
        return `http://localhost:8080/ipfs/${cid}`;
      default:
        return `https://ipfs.io/ipfs/${cid}`;
    }
  }

  /**
   * Verify file exists on IPFS
   * @param {string} cid - IPFS CID
   * @returns {Promise<boolean>} True if file exists
   */
  async verifyFileExists(cid) {
    try {
      await this.getFile(cid);
      return true;
    } catch (error) {
      console.log(`[IpfsService] File verification failed for CID ${cid}:`, error.message);
      return false;
    }
  }
}

module.exports = IpfsService;
