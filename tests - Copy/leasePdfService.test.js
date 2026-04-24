const LeasePdfService = require('../src/services/leasePdfService');
const fs = require('fs');
const path = require('path');

describe('LeasePdfService', () => {
  let pdfService;
  let mockLeaseData;
  let mockLessorData;
  let mockLesseeData;
  let mockAssetData;
  let mockTransactionHash;

  beforeEach(() => {
    pdfService = new LeasePdfService();
    
    // Mock data for testing
    mockLeaseData = {
      id: 'lease-123',
      landlord_id: 'landlord-456',
      tenant_id: 'tenant-789',
      rent_amount: 1500.00,
      currency: 'USD',
      start_date: '2024-01-01',
      end_date: '2024-12-31',
      status: 'active',
      renewable: true,
      security_deposit: 3000.00,
      city: 'Lagos',
      state: 'Lagos State',
      country: 'Nigeria',
      property_type: 'Apartment',
      bedrooms: 2,
      bathrooms: 1,
      square_footage: 850,
      landlord_stellar_address: 'GBL...LANDLORD',
      tenant_stellar_address: 'GBL...TENANT'
    };

    mockLessorData = {
      id: 'landlord-456',
      name: 'John Property Manager',
      address: '123 Property Lane, Lagos, Nigeria',
      email: 'landlord@example.com',
      phone: '+2348000000000'
    };

    mockLesseeData = {
      id: 'tenant-789',
      name: 'Jane Tenant',
      address: '456 Rent Street, Lagos, Nigeria',
      email: 'tenant@example.com',
      phone: '+2348111111111'
    };

    mockAssetData = {
      leaseId: 'lease-123',
      property_type: 'Apartment',
      address: '123 Property Lane, Lagos, Nigeria',
      bedrooms: 2,
      bathrooms: 1,
      square_footage: 850
    };

    mockTransactionHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
  });

  describe('generateLeaseAgreement', () => {
    it('should generate a PDF buffer successfully', async () => {
      const pdfBuffer = await pdfService.generateLeaseAgreement(
        mockLeaseData,
        mockLessorData,
        mockLesseeData,
        mockAssetData,
        mockTransactionHash
      );

      expect(pdfBuffer).toBeInstanceOf(Buffer);
      expect(pdfBuffer.length).toBeGreaterThan(0);
      
      // Check if it's a valid PDF by checking PDF header
      const pdfHeader = pdfBuffer.slice(0, 4).toString();
      expect(pdfHeader).toBe('%PDF');
    });

    it('should include transaction hash in the PDF', async () => {
      const pdfBuffer = await pdfService.generateLeaseAgreement(
        mockLeaseData,
        mockLessorData,
        mockLesseeData,
        mockAssetData,
        mockTransactionHash
      );

      const pdfText = pdfBuffer.toString('utf8');
      expect(pdfText).toContain(mockTransactionHash);
    });

    it('should format currency correctly', async () => {
      const pdfBuffer = await pdfService.generateLeaseAgreement(
        mockLeaseData,
        mockLessorData,
        mockLesseeData,
        mockAssetData,
        mockTransactionHash
      );

      const pdfText = pdfBuffer.toString('utf8');
      expect(pdfText).toContain('USD 1,500.00');
      expect(pdfText).toContain('USD 3,000.00');
    });

    it('should handle missing data gracefully', async () => {
      const incompleteLeaseData = { ...mockLeaseData, security_deposit: undefined };
      const incompleteLessorData = { ...mockLessorData, address: undefined };
      
      const pdfBuffer = await pdfService.generateLeaseAgreement(
        incompleteLeaseData,
        incompleteLessorData,
        mockLesseeData,
        mockAssetData,
        mockTransactionHash
      );

      expect(pdfBuffer).toBeInstanceOf(Buffer);
      expect(pdfBuffer.length).toBeGreaterThan(0);
      
      const pdfText = pdfBuffer.toString('utf8');
      expect(pdfText).toContain('N/A'); // Should show N/A for missing data
    });

    it('should throw error when invalid data provided', async () => {
      await expect(
        pdfService.generateLeaseAgreement(null, mockLessorData, mockLesseeData, mockAssetData, mockTransactionHash)
      ).rejects.toThrow('PDF generation failed');
    });
  });

  describe('formatCurrency', () => {
    it('should format currency with default values', () => {
      const result = pdfService.formatCurrency(1500, 'USD');
      expect(result).toBe('USD 1,500.00');
    });

    it('should handle zero values', () => {
      const result = pdfService.formatCurrency(0, 'USD');
      expect(result).toBe('USD 0.00');
    });

    it('should handle null/undefined values', () => {
      const result = pdfService.formatCurrency(null, 'USD');
      expect(result).toBe('USD 0.00');
    });

    it('should handle large numbers', () => {
      const result = pdfService.formatCurrency(1500000.50, 'USD');
      expect(result).toBe('USD 1,500,000.50');
    });

    it('should handle different currencies', () => {
      const result = pdfService.formatCurrency(1500, 'NGN');
      expect(result).toBe('NGN 1,500.00');
    });
  });

  describe('formatDate', () => {
    it('should format date string correctly', () => {
      const result = pdfService.formatDate('2024-01-01');
      expect(result).toBe('January 1, 2024');
    });

    it('should handle null/undefined dates', () => {
      const result = pdfService.formatDate(null);
      expect(result).toBe('N/A');
    });

    it('should handle invalid date strings', () => {
      const result = pdfService.formatDate('invalid-date');
      expect(result).toBe('invalid-date');
    });

    it('should handle ISO date strings', () => {
      const result = pdfService.formatDate('2024-01-01T10:30:00.000Z');
      expect(result).toContain('2024');
    });
  });

  describe('createDocumentDefinition', () => {
    it('should create a valid document definition', () => {
      const docDef = pdfService.createDocumentDefinition(
        mockLeaseData,
        mockLessorData,
        mockLesseeData,
        mockAssetData,
        mockTransactionHash
      );

      expect(docDef).toHaveProperty('content');
      expect(docDef).toHaveProperty('styles');
      expect(docDef).toHaveProperty('footer');
      expect(docDef.content).toBeInstanceOf(Array);
      expect(docDef.content.length).toBeGreaterThan(0);
    });

    it('should include all required sections', () => {
      const docDef = pdfService.createDocumentDefinition(
        mockLeaseData,
        mockLessorData,
        mockLesseeData,
        mockAssetData,
        mockTransactionHash
      );

      const content = docDef.content;
      const hasHeader = content.some(item => item.text === 'LEASE AGREEMENT');
      const hasParties = content.some(item => item.text && item.text.includes('BETWEEN:'));
      const hasProperty = content.some(item => item.text && item.text.includes('PROPERTY DETAILS:'));
      const hasTerms = content.some(item => item.text && item.text.includes('LEASE TERMS:'));
      const hasBlockchain = content.some(item => item.text && item.text.includes('BLOCKCHAIN VERIFICATION:'));

      expect(hasHeader).toBe(true);
      expect(hasParties).toBe(true);
      expect(hasProperty).toBe(true);
      expect(hasTerms).toBe(true);
      expect(hasBlockchain).toBe(true);
    });

    it('should include transaction hash in footer', () => {
      const docDef = pdfService.createDocumentDefinition(
        mockLeaseData,
        mockLessorData,
        mockLesseeData,
        mockAssetData,
        mockTransactionHash
      );

      expect(docDef.footer).toBeDefined();
      expect(docDef.footer.columns[0].text).toContain(mockTransactionHash);
    });

    it('should handle missing asset data', () => {
      const incompleteAssetData = { leaseId: 'lease-123' };
      
      const docDef = pdfService.createDocumentDefinition(
        mockLeaseData,
        mockLessorData,
        mockLesseeData,
        incompleteAssetData,
        mockTransactionHash
      );

      expect(docDef.content).toBeDefined();
      // Should still create a valid document definition
    });
  });

  describe('Integration Tests', () => {
    it('should generate a complete PDF with all data', async () => {
      const pdfBuffer = await pdfService.generateLeaseAgreement(
        mockLeaseData,
        mockLessorData,
        mockLesseeData,
        mockAssetData,
        mockTransactionHash
      );

      // Verify PDF structure
      expect(pdfBuffer.slice(0, 4).toString()).toBe('%PDF');
      
      // Verify content (convert to text and check key elements)
      const pdfText = pdfBuffer.toString('utf8');
      
      // Check for key elements
      expect(pdfText).toContain('LEASE AGREEMENT');
      expect(pdfText).toContain('John Property Manager');
      expect(pdfText).toContain('Jane Tenant');
      expect(pdfText).toContain('123 Property Lane');
      expect(pdfText).toContain('USD 1,500.00');
      expect(pdfText).toContain('USD 3,000.00');
      expect(pdfText).toContain('2 bedrooms');
      expect(pdfText).toContain('1 bathrooms');
      expect(pdfText).toContain('850');
      expect(pdfText).toContain(mockTransactionHash);
      expect(pdfText).toContain('January 1, 2024');
      expect(pdfText).toContain('December 31, 2024');
    });

    it('should save PDF to file for manual inspection', async () => {
      const pdfBuffer = await pdfService.generateLeaseAgreement(
        mockLeaseData,
        mockLessorData,
        mockLesseeData,
        mockAssetData,
        mockTransactionHash
      );

      // Save to test output directory for manual inspection
      const testOutputDir = path.join(__dirname, 'test-output');
      if (!fs.existsSync(testOutputDir)) {
        fs.mkdirSync(testOutputDir, { recursive: true });
      }
      
      const testPdfPath = path.join(testOutputDir, 'test-lease-agreement.pdf');
      fs.writeFileSync(testPdfPath, pdfBuffer);
      
      // Verify file was created
      expect(fs.existsSync(testPdfPath)).toBe(true);
      
      // Clean up
      if (fs.existsSync(testPdfPath)) {
        fs.unlinkSync(testPdfPath);
      }
    });
  });
});
