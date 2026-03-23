const nodemailer = require('nodemailer');
const twilio = require('twilio');

class NotificationService {
  constructor() {
    this.emailTransporter = null;
    this.twilioClient = null;
    this.isInitialized = false;
  }

  async initialize() {
    require('dotenv').config();
    
    // Initialize email transporter
    if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
      this.emailTransporter = nodemailer.createTransporter({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT) || 587,
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        }
      });
      console.log('Email service initialized');
    } else {
      console.warn('Email service not configured - missing SMTP environment variables');
    }

    // Initialize Twilio client
    if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
      this.twilioClient = twilio(
        process.env.TWILIO_ACCOUNT_SID,
        process.env.TWILIO_AUTH_TOKEN
      );
      console.log('SMS service initialized');
    } else {
      console.warn('SMS service not configured - missing Twilio environment variables');
    }

    this.isInitialized = true;
    console.log('NotificationService initialized');
  }

  async sendLeaseEndingSoonNotification(leaseData) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const { renterEmail, renterPhone, assetName, assetId, hoursRemaining, renterAddress } = leaseData;
    const notifications = [];

    // Send email notification
    if (this.emailTransporter && renterEmail) {
      try {
        const emailResult = await this.sendEmailNotification({
          to: renterEmail,
          subject: `Lease Ending Soon - ${assetName}`,
          text: this.getEmailText(leaseData),
          html: this.getEmailHtml(leaseData)
        });
        notifications.push({ type: 'email', success: true, result: emailResult });
      } catch (error) {
        console.error('Failed to send email notification:', error);
        notifications.push({ type: 'email', success: false, error: error.message });
      }
    }

    // Send SMS notification
    if (this.twilioClient && renterPhone) {
      try {
        const smsResult = await this.sendSMSNotification({
          to: renterPhone,
          body: this.getSMSBody(leaseData)
        });
        notifications.push({ type: 'sms', success: true, result: smsResult });
      } catch (error) {
        console.error('Failed to send SMS notification:', error);
        notifications.push({ type: 'sms', success: false, error: error.message });
      }
    }

    return notifications;
  }

  async sendEmailNotification({ to, subject, text, html }) {
    const mailOptions = {
      from: process.env.EMAIL_FROM || process.env.SMTP_USER,
      to,
      subject,
      text,
      html
    };

    const result = await this.emailTransporter.sendMail(mailOptions);
    return result;
  }

  async sendSMSNotification({ to, body }) {
    const result = await this.twilioClient.messages.create({
      body,
      from: process.env.TWILIO_PHONE_NUMBER,
      to
    });
    return result;
  }

  getEmailText(leaseData) {
    const { assetName, hoursRemaining, renterAddress, assetId } = leaseData;
    
    return `
Your lease for ${assetName} is ending soon!

Time remaining: ${hoursRemaining} hours
Asset ID: ${assetId}
Your address: ${renterAddress}

Top up now to keep using ${assetName}. Your access will be automatically revoked when your balance runs out.

If you have any questions, please contact support.
    `.trim();
  }

  getEmailHtml(leaseData) {
    const { assetName, hoursRemaining, renterAddress, assetId } = leaseData;
    
    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Lease Ending Soon</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
        .alert { background: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; border-radius: 8px; margin: 20px 0; }
        .info { background: #e3f2fd; border: 1px solid #90caf9; padding: 15px; border-radius: 8px; margin: 20px 0; }
        .cta { background: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; margin: 20px 0; }
        .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; font-size: 12px; color: #666; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🚨 Lease Ending Soon</h1>
        </div>
        
        <div class="alert">
            <strong>Warning:</strong> Your lease for <strong>${assetName}</strong> is ending in approximately ${hoursRemaining} hours.
        </div>
        
        <div class="info">
            <h3>Lease Details:</h3>
            <ul>
                <li><strong>Asset:</strong> ${assetName}</li>
                <li><strong>Asset ID:</strong> ${assetId}</li>
                <li><strong>Time Remaining:</strong> ${hoursRemaining} hours</li>
                <li><strong>Your Address:</strong> ${renterAddress}</li>
            </ul>
        </div>
        
        <div>
            <h3>⚠️ Action Required</h3>
            <p><strong>Top up now to keep using ${assetName}.</strong></p>
            <p>Your access will be automatically revoked when your balance runs out. Don't lose access to your leased asset!</p>
            
            <a href="#" class="cta">Top Up Now</a>
        </div>
        
        <div class="footer">
            <p>This is an automated notification from the LeaseFlow Protocol. If you have any questions or need assistance, please contact our support team.</p>
        </div>
    </div>
</body>
</html>
    `.trim();
  }

  getSMSBody(leaseData) {
    const { assetName, hoursRemaining } = leaseData;
    
    return `🚨 LeaseFlow Alert: Your lease for ${assetName} ends in ${hoursRemaining} hours. Top up now to keep using ${assetName}. Reply STOP to unsubscribe.`;
  }

  async testEmailConfiguration() {
    if (!this.emailTransporter) {
      throw new Error('Email service not configured');
    }

    try {
      await this.emailTransporter.verify();
      return { success: true, message: 'Email configuration is valid' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async testSMSConfiguration() {
    if (!this.twilioClient) {
      throw new Error('SMS service not configured');
    }

    try {
      const account = await this.twilioClient.api.accounts(process.env.TWILIO_ACCOUNT_SID).fetch();
      return { 
        success: true, 
        message: 'SMS configuration is valid',
        accountStatus: account.status 
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  getConfigurationStatus() {
    return {
      email: {
        configured: !!this.emailTransporter,
        smtpHost: process.env.SMTP_HOST ? 'configured' : 'not set',
        smtpUser: process.env.SMTP_USER ? 'configured' : 'not set'
      },
      sms: {
        configured: !!this.twilioClient,
        accountSid: process.env.TWILIO_ACCOUNT_SID ? 'configured' : 'not set',
        phoneNumber: process.env.TWILIO_PHONE_NUMBER ? 'configured' : 'not set'
      }
    };
  }
}

module.exports = NotificationService;
