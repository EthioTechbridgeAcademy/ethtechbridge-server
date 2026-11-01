import mysql from "mysql2/promise";
import "dotenv/config";

const poolConfig = {
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || "school_tutorial",
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 10),
  queueLimit: 0,
  charset: "utf8mb4",
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000
};

// Enable SSL if running in cloud production environments
if (process.env.DB_SSL === "true") {
  poolConfig.ssl = {
    rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== "false"
  };
}

export const pool = mysql.createPool(poolConfig);

// Handle idle connection drops gracefully
pool.on("connection", (conn) => {
  conn.on("error", (err) => {
    console.error("MySQL connection pool event error:", err.code || err.message);
  });
});
