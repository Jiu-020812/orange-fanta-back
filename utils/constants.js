export const allowedOrigins = [
  "https://myinvetory.com",
  "http://localhost:5173",
  "http://localhost:5175",
  "http://10.20.12.140:5173",
];

export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
