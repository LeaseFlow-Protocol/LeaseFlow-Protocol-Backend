class PropertyController {
  constructor(searchService) {
    this.searchService = searchService;
  }

  async search(req, res) {
    const filters = {
      minPrice: req.query.minPrice ? parseFloat(req.query.minPrice) : undefined,
      maxPrice: req.query.maxPrice ? parseFloat(req.query.maxPrice) : undefined,
      location: req.query.location,
      minScore: req.query.minScore ? parseInt(req.query.minScore) : undefined
    };

    try {
      const results = await this.searchService.searchProperties(filters);
      res.status(200).json({ success: true, ...results });
    } catch (error) {
      console.error('[PropertyController] Search error:', error);
      res.status(500).json({ success: false, error: 'Search failed' });
    }
  }

  async indexProperty(req, res) {
    try {
      const property = req.body;
      await this.searchService.indexProperty(property);
      res.status(201).json({ success: true, message: 'Property indexed' });
    } catch (error) {
      console.error('[PropertyController] Index error:', error);
      res.status(500).json({ success: false, error: 'Indexing failed' });
    }
  }
}

module.exports = { PropertyController };
