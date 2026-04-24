const pdfMake = require('pdfmake');
const fs = require('fs');
const path = require('path');

/**
 * Service for generating PDF lease agreements from lease data
 */
class LeasePdfService {
  constructor() {
    // Initialize fonts - using default fonts for now
    this.fonts = {
      Roboto: {
        normal: 'Roboto-Regular.ttf',
        bold: 'Roboto-Medium.ttf',
        italics: 'Roboto-Italic.ttf',
        bolditalics: 'Roboto-MediumItalic.ttf'
      }
    };
    
    this.printer = new pdfMake(this.fonts);
  }

  /**
   * Generate a PDF lease agreement from lease data
   * @param {object} leaseData - Lease data from database
   * @param {object} lessorData - Lessor information
   * @param {object} lesseeData - Lessee information  
   * @param {object} assetData - Asset/property information
   * @param {string} transactionHash - Soroban transaction hash
   * @returns {Buffer} PDF buffer
   */
  async generateLeaseAgreement(leaseData, lessorData, lesseeData, assetData, transactionHash) {
    try {
      const docDefinition = this.createDocumentDefinition(
        leaseData, 
        lessorData, 
        lesseeData, 
        assetData, 
        transactionHash
      );

      const pdfDoc = this.printer.createPdfKitDocument(docDefinition);
      
      return new Promise((resolve, reject) => {
        const chunks = [];
        pdfDoc.on('data', chunk => chunks.push(chunk));
        pdfDoc.on('end', () => resolve(Buffer.concat(chunks)));
        pdfDoc.on('error', reject);
        pdfDoc.end();
      });
    } catch (error) {
      console.error('[LeasePdfService] Error generating PDF:', error);
      throw new Error(`PDF generation failed: ${error.message}`);
    }
  }

  /**
   * Create the document definition for pdfmake
   * @param {object} leaseData - Lease data
   * @param {object} lessorData - Lessor information
   * @param {object} lesseeData - Lessee information
   * @param {object} assetData - Asset information
   * @param {string} transactionHash - Blockchain transaction hash
   * @returns {object} Document definition
   */
  createDocumentDefinition(leaseData, lessorData, lesseeData, assetData, transactionHash) {
    const currentDate = new Date().toLocaleDateString();
    const rentAmount = this.formatCurrency(leaseData.rent_amount, leaseData.currency);
    
    return {
      content: [
        // Header
        { 
          text: 'LEASE AGREEMENT', 
          style: 'header',
          alignment: 'center',
          margin: [0, 0, 0, 20]
        },
        
        // Agreement details
        {
          text: `This Lease Agreement is made and entered into on ${currentDate}`,
          style: 'normal',
          margin: [0, 0, 0, 10]
        },
        
        // Parties
        {
          text: 'BETWEEN:',
          style: 'subheader',
          margin: [0, 20, 0, 10]
        },
        
        // Lessor section
        {
          columns: [
            {
              width: '*',
              text: [
                { text: 'LESSOR (LANDLORD):', style: 'label' },
                { text: '\n' + (lessorData.name || 'N/A'), style: 'bold' },
                { text: '\n' + (lessorData.address || 'N/A'), style: 'normal' },
                { text: '\nStellar Address: ' + (leaseData.landlord_stellar_address || 'N/A'), style: 'small' }
              ]
            }
          ],
          margin: [0, 0, 0, 20]
        },
        
        // Lessee section  
        {
          columns: [
            {
              width: '*',
              text: [
                { text: 'LESSEE (TENANT):', style: 'label' },
                { text: '\n' + (lesseeData.name || 'N/A'), style: 'bold' },
                { text: '\n' + (lesseeData.address || 'N/A'), style: 'normal' },
                { text: '\nStellar Address: ' + (leaseData.tenant_stellar_address || 'N/A'), style: 'small' }
              ]
            }
          ],
          margin: [0, 0, 0, 20]
        },
        
        // Property details
        {
          text: 'PROPERTY DETAILS:',
          style: 'subheader',
          margin: [0, 20, 0, 10]
        },
        
        {
          columns: [
            {
              width: '*',
              ul: [
                `Property Type: ${assetData.property_type || 'Residential'}`,
                `Address: ${assetData.address || 'N/A'}`,
                `City: ${leaseData.city || 'N/A'}, ${leaseData.state || 'N/A'}, ${leaseData.country || 'Nigeria'}`,
                `Bedrooms: ${assetData.bedrooms || leaseData.bedrooms || 'N/A'}`,
                `Bathrooms: ${assetData.bathrooms || leaseData.bathrooms || 'N/A'}`,
                `Square Footage: ${assetData.square_footage || leaseData.square_footage || 'N/A'}`
              ]
            }
          ],
          margin: [0, 0, 0, 20]
        },
        
        // Lease terms
        {
          text: 'LEASE TERMS:',
          style: 'subheader',
          margin: [0, 20, 0, 10]
        },
        
        {
          columns: [
            {
              width: '*',
              ul: [
                `Lease Term: ${this.formatDate(leaseData.start_date)} to ${this.formatDate(leaseData.end_date)}`,
                `Monthly Rent: ${rentAmount}`,
                `Payment Currency: ${leaseData.currency}`,
                `Security Deposit: ${this.formatCurrency(leaseData.security_deposit || 0, leaseData.currency)}`,
                `Lease Status: ${leaseData.status.toUpperCase()}`,
                `Renewable: ${leaseData.renewable ? 'Yes' : 'No'}`
              ]
            }
          ],
          margin: [0, 0, 0, 20]
        },
        
        // Blockchain integration
        {
          text: 'BLOCKCHAIN VERIFICATION:',
          style: 'subheader',
          margin: [0, 20, 0, 10]
        },
        
        {
          text: [
            { text: 'This lease agreement is cryptographically anchored to the blockchain.\n', style: 'normal' },
            { text: 'Transaction Hash: ', style: 'label' },
            { text: transactionHash, style: 'code' }
          ],
          margin: [0, 0, 0, 20]
        },
        
        // Legal clauses (simplified)
        {
          text: 'TERMS AND CONDITIONS:',
          style: 'subheader',
          margin: [0, 20, 0, 10]
        },
        
        {
          text: `1. The Lessee agrees to pay the monthly rent of ${rentAmount} on or before the due date.\n\n` +
                `2. The security deposit shall be held according to applicable local laws.\n\n` +
                `3. The Lessee shall maintain the property in good condition.\n\n` +
                `4. This agreement is governed by the laws of ${leaseData.country || 'Nigeria'}.\n\n` +
                `5. Both parties acknowledge that this lease is recorded on the blockchain for immutable verification.`,
          style: 'normal',
          margin: [0, 0, 0, 20]
        },
        
        // Signature lines
        {
          columns: [
            {
              width: '*',
              text: [
                { text: 'LESSOR SIGNATURE:', style: 'label' },
                { text: '\n\n_________________________', style: 'normal' },
                { text: '\nDate: _______________', style: 'normal' }
              ]
            },
            {
              width: '*',
              text: [
                { text: 'LESSEE SIGNATURE:', style: 'label' },
                { text: '\n\n_________________________', style: 'normal' },
                { text: '\nDate: _______________', style: 'normal' }
              ]
            }
          ],
          margin: [0, 30, 0, 20]
        }
      ],
      
      footer: {
        columns: [
          {
            width: '*',
            text: `Generated by LeaseFlow Protocol | TX: ${transactionHash}`,
            style: 'footer',
            alignment: 'center'
          }
        ]
      },
      
      styles: {
        header: {
          fontSize: 24,
          bold: true,
          margin: [0, 0, 0, 10]
        },
        subheader: {
          fontSize: 16,
          bold: true,
          margin: [0, 10, 0, 5]
        },
        normal: {
          fontSize: 11,
          margin: [0, 0, 0, 5]
        },
        bold: {
          fontSize: 12,
          bold: true,
          margin: [0, 0, 0, 5]
        },
        label: {
          fontSize: 11,
          bold: true,
          margin: [0, 0, 0, 2]
        },
        small: {
          fontSize: 9,
          italics: true,
          margin: [0, 0, 0, 2]
        },
        code: {
          fontSize: 9,
          bold: true,
          font: 'Courier',
          margin: [0, 0, 0, 2]
        },
        footer: {
          fontSize: 8,
          italics: true,
          margin: [0, 20, 0, 0]
        }
      },
      
      defaultStyle: {
        font: 'Roboto',
        fontSize: 11
      }
    };
  }

  /**
   * Format currency amount
   * @param {number} amount - Amount to format
   * @param {string} currency - Currency code
   * @returns {string} Formatted currency string
   */
  formatCurrency(amount, currency) {
    const formattedAmount = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount || 0);
    
    return `${currency} ${formattedAmount}`;
  }

  /**
   * Format date string
   * @param {string} dateString - Date string to format
   * @returns {string} Formatted date
   */
  formatDate(dateString) {
    if (!dateString) return 'N/A';
    
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    } catch (error) {
      return dateString;
    }
  }
}

module.exports = LeasePdfService;
