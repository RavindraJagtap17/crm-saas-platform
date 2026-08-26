const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const cookieParser = require("cookie-parser");

const config = require("./config");
const routes = require("./routes");
const notFound = require("./middlewares/notFound");
const errorHandler = require("./middlewares/errorHandler");

const app = express();

app.use(helmet());
app.use(
  cors({
    origin: config.corsAllowedOrigins.length > 0 ? config.corsAllowedOrigins : false,
    // Refresh tokens travel as an httpOnly cookie, which requires the
    // browser to be told cross-origin credentials are allowed — paired
    // deliberately with an explicit origin allowlist above, never a
    // wildcard, since credentials + "*" is not something browsers allow
    // anyway and would be insecure if they did.
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());
app.use(morgan(config.isProduction ? "combined" : "dev"));

app.use(routes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
