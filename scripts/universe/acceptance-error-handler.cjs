const acceptanceErrorHandler = (error, _req, res, next) => {
  if (res.headersSent) return next(error);
  if (error?.type === "entity.too.large")
    return res
      .status(413)
      .json({
        code: "REQUEST_TOO_LARGE",
        error: "Request body exceeds the limit.",
      });
  if (error?.type === "entity.parse.failed")
    return res
      .status(400)
      .json({ code: "INVALID_REQUEST", error: "Invalid JSON request body." });
  return res
    .status(500)
    .json({
      code: "ACCEPTANCE_INTERNAL_ERROR",
      error: "The isolated handler failed.",
    });
};
module.exports = acceptanceErrorHandler;
