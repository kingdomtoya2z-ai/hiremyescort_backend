import multer from 'multer';

const storage = multer.memoryStorage();

//single upload
export const singleUpload = multer({ storage }).single('file');

// Multiple upload = max 4 images (premium/golden limit). Free ads are capped
// at 1 in the controller BEFORE any cloudinary upload or coin deduction, so a
// free ad can never end up with more than 1 image.
export const multipleUpload = multer({ storage }).array('files', 4);

//banner upload (single image, field name: "image")
export const bannerUpload = multer({ storage }).single('image');

// City tile image (single image, field name: "image") for
// POST /api/v1/location/admin/toggle-top-city. Same field name as the banner
// upload so the admin client can reuse one code path.
export const cityImageUpload = multer({ storage }).single('image');

// Wrap multer so the global 4-image cap and other upload errors return a clean
// JSON 400 instead of crashing the request with a raw error/500.
export const runUpload = (uploadMiddleware) => (req, res, next) => {
  uploadMiddleware(req, res, (err) => {
    if (err) {
      if (
        err.code === 'LIMIT_UNEXPECTED_FILE' ||
        err.code === 'LIMIT_FILE_COUNT' ||
        err.code === 'LIMIT_FILE_SIZE'
      ) {
        return res.status(400).json({
          success: false,
          message: 'Too many images. Maximum 4 images allowed for an ad.',
        });
      }
      return res.status(400).json({
        success: false,
        message: err.message || 'File upload failed',
      });
    }
    next();
  });
};