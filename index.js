const express = require('express');
const cors = require('cors');
require('dotenv').config();
const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ 
    project: 'LeaseFlow Protocol', 
    status: 'Active',
    contract_id: 'CAEGD57WVTVQSYWYB23AISBW334QO7WNA5XQ56S45GH6BP3D2AVHKUG4'
  });
});

app.post('/listings', async (req, res) => {
  const { title, price, currency } = req.body;
  const highValueThreshold = 10; // XLM/hr

  console.log(`New Listing: ${title} - ${price} ${currency}/hr`);

  // Acceptance Criteria: Post to discord for high-value items
  if (price >= highValueThreshold && currency === 'XLM') {
    const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
    if (webhookUrl) {
      try {
        await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: `🚀 New Listing: **${title}** - **${price} ${currency}/hr**`
          })
        });
        console.log('Discord notification sent.');
      } catch (error) {
        console.error('Error sending Discord notification:', error);
      }
    } else {
      console.warn('DISCORD_WEBHOOK_URL is not defined.');
    }
  }

  res.status(201).json({ 
    message: 'Listing created successfully',
    listing: { title, price, currency }
  });
});

if (require.main === module) {
  app.listen(port, () => {
    console.log(`LeaseFlow Backend listening at http://localhost:${port}`);
  });
}

module.exports = app;
