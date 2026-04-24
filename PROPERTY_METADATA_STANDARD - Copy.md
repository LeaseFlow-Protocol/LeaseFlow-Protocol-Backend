# Standardizing On-Chain Property IDs (LeaseFlow Protocol)

## Overview
To ensure interoperability with future Real Estate Marketplaces on the Stellar network, LeaseFlow implements a universal "Property Asset Metadata" standard. This allows properties to be universally identified and described on-chain.

## On-Chain Representation
Each property is represented as a distinct asset or within a Soroban smart contract state, associated with a unique IPFS CID containing the property metadata. The standard relies on a deterministic hashing of the property's physical location (coordinates + standardized address) combined with the owner's Stellar account to create a unique identifier.

## JSON Schema Standard (Stored on IPFS)

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "PropertyAssetMetadata",
  "type": "object",
  "properties": {
    "propertyId": {
      "type": "string",
      "description": "Unique deterministic hash of the property"
    },
    "address": {
      "type": "object",
      "properties": {
        "street": { "type": "string" },
        "city": { "type": "string" },
        "stateProvince": { "type": "string" },
        "country": { "type": "string" },
        "postalCode": { "type": "string" }
      },
      "required": ["street", "city", "country"]
    },
    "specifications": {
      "type": "object",
      "properties": {
        "bedrooms": { "type": "number" },
        "bathrooms": { "type": "number" },
        "squareFootage": { "type": "number" },
        "zoning": { "type": "string" },
        "yearBuilt": { "type": "number" }
      },
      "required": ["bedrooms", "squareFootage", "zoning"]
    }
  },
  "required": ["propertyId", "address", "specifications"]
}
```

By agreeing on how to store "Bedrooms," "SqFt," and "Zoning" on-chain, we ensure that LeaseFlow is interoperable with any decentralized application built on Stellar.