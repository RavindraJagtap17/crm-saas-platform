const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");

const config = require("./config");
const routes = require("./routes");
const notFound = require("./middlewares/notFound");
const errorHandler = require("./middlewares/errorHandler");

const app = express();

app.use(helmet());
app.use(
  cors({
    origin: config.corsAllowedOrigins.length > 0 ? config.corsAllowedOrigins : false,
  })
);
app.use(express.json());
app.use(morgan(config.isProduction ? "combined" : "dev"));

app.use(routes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
