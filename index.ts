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

type ENGINE_RESPONSE_TYPE =
  | "order_created"
  | "order_cancelled"
  | "balance"
  | "balance_updated"
  | "depth"
  | "orders"
  | "order"
  | "fills"
  | "error"; // for anything that did not succeed

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
): ENGINE_RESPONSE => {
  try {
    let depth = matchineEngine.getDepth(engineRequest.payload.symbol);
    return {
      requestId: engineRequest.requestId,
      type: "depth",
      payload: depth,
    };
  } catch (error) {
    return { requestId: engineRequest.requestId, type: "error" };
  }
};

const handleGetOrdersRequest = (
  engineRequest: ENGINE_REQUEST,
): ENGINE_RESPONSE => {
  try {
    let orders = matchineEngine.getOrders();
    return {
      requestId: engineRequest.requestId,
      type: "orders",
      payload: orders,
    };
  } catch (error) {
    return { requestId: engineRequest.requestId, type: "error" };
  }
};

const handleGetFillsRequest = (
  engineRequest: ENGINE_REQUEST,
): ENGINE_RESPONSE => {
  try {
    let fills = matchineEngine.getFills();
    return {
      requestId: engineRequest.requestId,
      type: "fills",
      payload: fills,
    };
  } catch (error) {
    return { requestId: engineRequest.requestId, type: "error" };
  }
};
const handleGetOrderRequest = (
  engineRequest: ENGINE_REQUEST,
): ENGINE_RESPONSE => {
  try {
    let order = matchineEngine.getOrder(engineRequest.payload.orderId);
    if (!order) throw new Error();

    return {
      requestId: engineRequest.requestId,
      type: "order",
      payload: order,
    };
  } catch (error) {
    return { requestId: engineRequest.requestId, type: "error" };
  }
};
const handleGetBalanceRequest = (
  engineRequest: ENGINE_REQUEST,
): ENGINE_RESPONSE => {
  try {
    let balance = matchineEngine.getBalance(
      engineRequest.payload.userId,
      engineRequest.payload.symbol,
    );
    return {
      requestId: engineRequest.requestId,
      type: "balance",
      payload: balance,
    };
  } catch (error) {
    return { requestId: engineRequest.requestId, type: "error" };
  }
};
const handleCancelOrderRequest = (
  engineRequest: ENGINE_REQUEST,
): ENGINE_RESPONSE => {
  try {
    let { status } = matchineEngine.cancelOrder(engineRequest.payload.orderId);
    if (status != "CANCELLED") throw new Error();

    return { requestId: engineRequest.requestId, type: "order_cancelled" };
  } catch (error) {
    return { requestId: engineRequest.requestId, type: "error" };
  }
};

const handleAddBalanceRequest = (
  engineRequest: ENGINE_REQUEST,
): ENGINE_RESPONSE => {
  try {
    matchineEngine.addBalance(
      engineRequest.payload.userId,
      engineRequest.payload.amount,
    );
    return { requestId: engineRequest.requestId, type: "balance_updated" };
  } catch (error) {
    return { requestId: engineRequest.requestId, type: "error" };
  }
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
