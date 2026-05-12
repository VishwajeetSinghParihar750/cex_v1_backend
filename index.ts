import MatchingEngine from "./classes/MatchingEngine.js";
import { createClient } from "redis";

const matchineEngine = new MatchingEngine();
const redisClient = createClient({ url: process.env.REDIS_URL! });

type ENGINE_REQUEST_TYPE =
  | "create_order"
  | "cancel_order"
  | "get_balance"
  | "add_balance"
  | "get_depth"
  | "get_orders"
  | "get_order"
  | "get_fills";

type ENGINE_RESPONSE_TYPE = string;

type ENGINE_REQUEST = {
  requestId: string;
  type: ENGINE_REQUEST_TYPE;
  payload?: any;
};
type ENGINE_RESPONSE = {
  requestId: string;
  type: ENGINE_RESPONSE_TYPE;
  payload?: any;
};

const handleGetDepthRequest = (
  engineRequest: ENGINE_REQUEST,
): ENGINE_RESPONSE_TYPE => {
  return "";
};

const handleGetOrdersRequest = (
  engineRequest: ENGINE_REQUEST,
): ENGINE_RESPONSE_TYPE => {
  return "";
};
const handleGetFillsRequest = (
  engineRequest: ENGINE_REQUEST,
): ENGINE_RESPONSE_TYPE => {
  return "";
};
const handleGetOrderRequest = (
  engineRequest: ENGINE_REQUEST,
): ENGINE_RESPONSE_TYPE => {
  return "";
};
const handleGetBalanceRequest = (
  engineRequest: ENGINE_REQUEST,
): ENGINE_RESPONSE_TYPE => {
  return "";
};
const handleCancelOrderRequest = (
  engineRequest: ENGINE_REQUEST,
): ENGINE_RESPONSE_TYPE => {
  return "";
};

const handleAddBalanceRequest = (
  engineRequest: ENGINE_REQUEST,
): ENGINE_RESPONSE_TYPE => {
  matchineEngine.addBalance(
    engineRequest.payload.userId,
    engineRequest.payload.amount,
  );

  return "";
};

const handleEngineRequest = (engineRequest: ENGINE_REQUEST) => {
  switch (engineRequest.type) {
    case "add_balance":
      handleAddBalanceRequest(engineRequest);
      break;
    case "cancel_order":
      handleCancelOrderRequest(engineRequest);
      break;

    case "create_order":
      handleCancelOrderRequest(engineRequest);
      break;
    case "get_balance":
      handleGetBalanceRequest(engineRequest);
      break;
    case "get_depth":
      handleGetDepthRequest(engineRequest);
      break;
    case "get_fills":
      handleGetFillsRequest(engineRequest);
      break;
    case "get_order":
      handleGetOrderRequest(engineRequest);
      break;
    case "get_orders":
      handleGetOrdersRequest(engineRequest);
      break;

    default:
      break;
  }
};

const setupEngine = async () => {
  redisClient.on("error", (err) => {
    console.log("redis error : ", err);
  });

  await redisClient.connect();

  while (true) {
    const engineRequest = await redisClient.blPop("engine_request", 0);
    if (engineRequest) handleEngineRequest(JSON.parse(engineRequest.element));
  }
};

await setupEngine();
