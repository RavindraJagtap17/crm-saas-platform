const userService = require("../services/userService");
const asyncHandler = require("../utils/asyncHandler");

const list = asyncHandler(async (req, res) => {
  res.json({ users: await userService.list(req.tenantId) });
});

const invite = asyncHandler(async (req, res) => {
  const user = await userService.invite(req.tenantId, req.body);
  res.status(201).json({ user });
});

const setStatus = asyncHandler(async (req, res) => {
  const user = await userService.setStatus(req.tenantId, req.params.id, req.body);
  res.json({ user });
});

module.exports = { list, invite, setStatus };
