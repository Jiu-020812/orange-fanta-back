export const allowedOrigins = [
  "https://myinvetory.com",
  "http://localhost:5173",
  "http://localhost:5175",
];

export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
