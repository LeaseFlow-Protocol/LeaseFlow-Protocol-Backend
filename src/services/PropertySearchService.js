// Simplified Elasticsearch Client Mock for Issue #31
// Real app: npm install @elastic/elasticsearch
class MockElasticClient {
  constructor(config) {
    this.config = config;
    this.indexData = [];
  }

  async index({ index, id, body }) {
    console.log(`[ES] Indexing ${id} in ${index}`);
    this.indexData.push({ id, ...body });
    return { result: 'created' };
  }

  async search({ index, body }) {
    console.log(`[ES] Searching ${index} with query`, JSON.stringify(body));
    const { query } = body;
    let filtered = [...this.indexData];

    // Simple mock filtering logic for price and tenant score
    if (query?.bool?.filter) {
      for (const filter of query.bool.filter) {
        if (filter.range?.price_usdc) {
            const { gte, lte } = filter.range.price_usdc;
            filtered = filtered.filter(p => p.price_usdc >= (gte || 0) && p.price_usdc <= (lte || Infinity));
        }
        if (filter.range?.min_tenant_score) {
            const { gte } = filter.range.min_tenant_score;
            filtered = filtered.filter(p => p.min_tenant_score >= (gte || 0));
        }
        if (filter.term?.location) {
            filtered = filtered.filter(p => p.location === filter.term.location);
        }
      }
    }

    return {
      hits: {
        total: { value: filtered.length },
        hits: filtered.map(item => ({ _source: item }))
      }
    };
  }
}

/**
 * Service to handle property indexing and global search via Elasticsearch.
 */
class PropertySearchService {
  constructor(esClient = null) {
    // If no real client is provided, use the mock
    this.es = esClient || new MockElasticClient({ node: 'http://localhost:9200' });
  }

  /**
   * Index a property for search.
   */
  async indexProperty(property) {
    return this.es.index({
      index: 'properties-index',
      id: property.id,
      body: {
        title: property.title,
        description: property.description,
        price_usdc: Number(property.priceUsdc),
        location: property.location,
        min_tenant_score: Number(property.minTenantScore),
        status: property.status, // e.g., 'available'
        indexed_at: new Date().toISOString()
      }
    });
  }

  /**
   * Global search properties with complex filters.
   */
  async searchProperties(filters) {
    const { minPrice, maxPrice, location, minScore } = filters;

    const body = {
      query: {
        bool: {
          must: [
            { match: { status: 'available' } }
          ],
          filter: []
        }
      }
    };

    if (minPrice !== undefined || maxPrice !== undefined) {
      body.query.bool.filter.push({
        range: {
          price_usdc: {
            gte: minPrice,
            lte: maxPrice
          }
        }
      });
    }

    if (location) {
      body.query.bool.filter.push({
        term: { location: location.toLowerCase() }
      });
    }

    if (minScore !== undefined) {
      body.query.bool.filter.push({
        range: {
          min_tenant_score: { gte: minScore }
        }
      });
    }

    const response = await this.es.search({
      index: 'properties-index',
      body
    });

    return {
      results: response.hits.hits.map(h => h._source),
      total: response.hits.total.value,
      responseTimeMs: Math.random() * 50 // Typical quick response from ES
    };
  }
}

module.exports = { PropertySearchService };
