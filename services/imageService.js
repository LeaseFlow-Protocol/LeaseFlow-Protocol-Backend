const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const THUMBNAIL_WIDTH = 300;
const THUMBNAIL_HEIGHT = 300;
const OPTIMIZED_DIR = path.join(__dirname, '..', 'uploads', 'optimized');

if (!fs.existsSync(OPTIMIZED_DIR)) {
  fs.mkdirSync(OPTIMIZED_DIR, { recursive: true });
}

async function optimizeImage(inputPath, options = {}) {
  const {
    width = THUMBNAIL_WIDTH,
    height = THUMBNAIL_HEIGHT,
    fit = 'cover',
    format = 'webp'
  } = options;

  const filename = path.basename(inputPath, path.extname(inputPath));
  const outputFilename = `${filename}_${width}x${height}.${format}`;
  const outputPath = path.join(OPTIMIZED_DIR, outputFilename);

  if (fs.existsSync(outputPath)) {
    return outputPath;
  }

  await sharp(inputPath)
    .resize(width, height, { fit })
    .toFormat(format, { quality: 80 })
    .toFile(outputPath);

  return outputPath;
}

async function getImageMetadata(inputPath) {
  const metadata = await sharp(inputPath).metadata();
  return {
    width: metadata.width,
    height: metadata.height,
    format: metadata.format,
    size: fs.statSync(inputPath).size
  };
}

module.exports = {
  optimizeImage,
  getImageMetadata,
  THUMBNAIL_WIDTH,
  THUMBNAIL_HEIGHT,
  OPTIMIZED_DIR
};