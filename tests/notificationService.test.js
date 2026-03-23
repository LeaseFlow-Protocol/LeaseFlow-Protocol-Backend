const NotificationService = require('../services/notificationService');

describe('NotificationService', () => {
  let service;
  let originalEnv;

  beforeEach(() => {
    service = new NotificationService();
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  describe('initialize', () => {
    it('should initialize email service when SMTP credentials are provided', async () => {
      process.env.SMTP_HOST = 'smtp.gmail.com';
      process.env.SMTP_USER = 'test@gmail.com';
      process.env.SMTP_PASS = 'password';
      process.env.SMTP_PORT = '587';

      const nodemailer = require('nodemailer');
      const mockTransporter = { sendMail: jest.fn() };
      nodemailer.createTransporter = jest.fn().mockReturnValue(mockTransporter);

      await service.initialize();

      expect(nodemailer.createTransporter).toHaveBeenCalledWith({
        host: 'smtp.gmail.com',
        port: 587,
        secure: false,
        auth: {
          user: 'test@gmail.com',
          pass: 'password'
        }
      });
      expect(service.emailTransporter).toBe(mockTransporter);
    });

    it('should initialize SMS service when Twilio credentials are provided', async () => {
      process.env.TWILIO_ACCOUNT_SID = 'AC123';
      process.env.TWILIO_AUTH_TOKEN = 'token123';

      const twilio = require('twilio');
      const mockClient = { messages: { create: jest.fn() } };
      twilio.mockReturnValue(mockClient);

      await service.initialize();

      expect(twilio).toHaveBeenCalledWith('AC123', 'token123');
      expect(service.twilioClient).toBe(mockClient);
    });

    it('should handle missing credentials gracefully', async () => {
      delete process.env.SMTP_HOST;
      delete process.env.TWILIO_ACCOUNT_SID;

      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

      await service.initialize();

      expect(consoleWarnSpy).toHaveBeenCalledWith('Email service not configured - missing SMTP environment variables');
      expect(consoleWarnSpy).toHaveBeenCalledWith('SMS service not configured - missing Twilio environment variables');
    });
  });

  describe('getEmailText', () => {
    it('should generate correct email text', () => {
      const leaseData = {
        assetName: 'Premium Car',
        hoursRemaining: 1,
        renterAddress: 'X2F7A3N3D5A2B6C8E9F1G4H7J0K3L6M9N2O5P8Q1R4S7T0U3V6W9Y2Z5A8B1C4',
        assetId: '123'
      };

      const text = service.getEmailText(leaseData);

      expect(text).toContain('Premium Car');
      expect(text).toContain('1 hours');
      expect(text).toContain('Asset ID: 123');
      expect(text).toContain('Top up now to keep using Premium Car');
    });
  });

  describe('getSMSBody', () => {
    it('should generate correct SMS body', () => {
      const leaseData = {
        assetName: 'Premium Car',
        hoursRemaining: 1
      };

      const body = service.getSMSBody(leaseData);

      expect(body).toContain('🚨 LeaseFlow Alert');
      expect(body).toContain('Premium Car');
      expect(body).toContain('1 hours');
      expect(body).toContain('Top up now to keep using Premium Car');
    });
  });

  describe('getConfigurationStatus', () => {
    it('should return correct configuration status', () => {
      service.emailTransporter = { mock: 'email' };
      service.twilioClient = { mock: 'sms' };
      process.env.SMTP_HOST = 'smtp.gmail.com';
      process.env.TWILIO_ACCOUNT_SID = 'AC123';

      const status = service.getConfigurationStatus();

      expect(status.email.configured).toBe(true);
      expect(status.email.smtpHost).toBe('configured');
      expect(status.sms.configured).toBe(true);
      expect(status.sms.accountSid).toBe('configured');
    });

    it('should return not configured status when services are missing', () => {
      service.emailTransporter = null;
      service.twilioClient = null;

      const status = service.getConfigurationStatus();

      expect(status.email.configured).toBe(false);
      expect(status.sms.configured).toBe(false);
    });
  });

  describe('sendLeaseEndingSoonNotification', () => {
    beforeEach(() => {
      service.emailTransporter = { sendMail: jest.fn().mockResolvedValue({ messageId: 'email123' }) };
      service.twilioClient = { 
        messages: { 
          create: jest.fn().mockResolvedValue({ sid: 'sms123' }) 
        } 
      };
      service.isInitialized = true;
    });

    it('should send both email and SMS notifications', async () => {
      const leaseData = {
        renterEmail: 'test@example.com',
        renterPhone: '+1234567890',
        assetName: 'Premium Car',
        assetId: '123',
        hoursRemaining: 1,
        renterAddress: 'X2F7A3N3D5A2B6C8E9F1G4H7J0K3L6M9N2O5P8Q1R4S7T0U3V6W9Y2Z5A8B1C4'
      };

      const results = await service.sendLeaseEndingSoonNotification(leaseData);

      expect(results).toHaveLength(2);
      expect(results[0].type).toBe('email');
      expect(results[0].success).toBe(true);
      expect(results[1].type).toBe('sms');
      expect(results[1].success).toBe(true);

      expect(service.emailTransporter.sendMail).toHaveBeenCalled();
      expect(service.twilioClient.messages.create).toHaveBeenCalled();
    });

    it('should handle email sending failure', async () => {
      service.emailTransporter.sendMail.mockRejectedValue(new Error('Email failed'));

      const leaseData = {
        renterEmail: 'test@example.com',
        renterPhone: '+1234567890',
        assetName: 'Premium Car',
        assetId: '123',
        hoursRemaining: 1,
        renterAddress: 'X2F7A3N3D5A2B6C8E9F1G4H7J0K3L6M9N2O5P8Q1R4S7T0U3V6W9Y2Z5A8B1C4'
      };

      const results = await service.sendLeaseEndingSoonNotification(leaseData);

      expect(results[0].type).toBe('email');
      expect(results[0].success).toBe(false);
      expect(results[0].error).toBe('Email failed');
      expect(results[1].type).toBe('sms');
      expect(results[1].success).toBe(true);
    });

    it('should skip email if no email address provided', async () => {
      const leaseData = {
        renterPhone: '+1234567890',
        assetName: 'Premium Car',
        assetId: '123',
        hoursRemaining: 1,
        renterAddress: 'X2F7A3N3D5A2B6C8E9F1G4H7J0K3L6M9N2O5P8Q1R4S7T0U3V6W9Y2Z5A8B1C4'
      };

      const results = await service.sendLeaseEndingSoonNotification(leaseData);

      expect(results).toHaveLength(1);
      expect(results[0].type).toBe('sms');
      expect(results[0].success).toBe(true);
      expect(service.emailTransporter.sendMail).not.toHaveBeenCalled();
    });

    it('should skip SMS if no phone number provided', async () => {
      const leaseData = {
        renterEmail: 'test@example.com',
        assetName: 'Premium Car',
        assetId: '123',
        hoursRemaining: 1,
        renterAddress: 'X2F7A3N3D5A2B6C8E9F1G4H7J0K3L6M9N2O5P8Q1R4S7T0U3V6W9Y2Z5A8B1C4'
      };

      const results = await service.sendLeaseEndingSoonNotification(leaseData);

      expect(results).toHaveLength(1);
      expect(results[0].type).toBe('email');
      expect(results[0].success).toBe(true);
      expect(service.twilioClient.messages.create).not.toHaveBeenCalled();
    });
  });

  describe('testEmailConfiguration', () => {
    it('should test email configuration successfully', async () => {
      service.emailTransporter = { verify: jest.fn().mockResolvedValue(true) };

      const result = await service.testEmailConfiguration();

      expect(result.success).toBe(true);
      expect(result.message).toBe('Email configuration is valid');
    });

    it('should handle email configuration test failure', async () => {
      service.emailTransporter = { verify: jest.fn().mockRejectedValue(new Error('Invalid config')) };

      const result = await service.testEmailConfiguration();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid config');
    });

    it('should throw error when email service not configured', async () => {
      service.emailTransporter = null;

      await expect(service.testEmailConfiguration()).rejects.toThrow('Email service not configured');
    });
  });

  describe('testSMSConfiguration', () => {
    it('should test SMS configuration successfully', async () => {
      service.twilioClient = {
        api: {
          accounts: jest.fn().mockReturnValue({
            fetch: jest.fn().mockResolvedValue({ status: 'active' })
          })
        }
      };
      process.env.TWILIO_ACCOUNT_SID = 'AC123';

      const result = await service.testSMSConfiguration();

      expect(result.success).toBe(true);
      expect(result.message).toBe('SMS configuration is valid');
      expect(result.accountStatus).toBe('active');
    });

    it('should handle SMS configuration test failure', async () => {
      service.twilioClient = {
        api: {
          accounts: jest.fn().mockReturnValue({
            fetch: jest.fn().mockRejectedValue(new Error('Invalid token'))
          })
        }
      };
      process.env.TWILIO_ACCOUNT_SID = 'AC123';

      const result = await service.testSMSConfiguration();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid token');
    });

    it('should throw error when SMS service not configured', async () => {
      service.twilioClient = null;

      await expect(service.testSMSConfiguration()).rejects.toThrow('SMS service not configured');
    });
  });
});
