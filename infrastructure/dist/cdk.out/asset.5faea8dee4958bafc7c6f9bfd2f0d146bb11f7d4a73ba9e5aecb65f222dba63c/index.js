"use strict";
/**
 * Lambda handler for validating MCP server endpoints
 * This file is the entry point for the Lambda function in the validation pipeline
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
// Re-export the handler from validation.ts
var validation_1 = require("./validation");
Object.defineProperty(exports, "handler", { enumerable: true, get: function () { return validation_1.handler; } });
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9jZGsub3V0L2Fzc2V0LjVmYWVhOGRlZTQ5NThiYWZjN2M2ZjliZmQyZjBkMTQ2YmIxMWY3ZDRhNzNiYTllNWFlY2I2NWYyMjJkYmE2M2MvaW5kZXgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7R0FHRzs7O0FBRUgsMkNBQTJDO0FBQzNDLDJDQUF1QztBQUE5QixxR0FBQSxPQUFPLE9BQUEiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIExhbWJkYSBoYW5kbGVyIGZvciB2YWxpZGF0aW5nIE1DUCBzZXJ2ZXIgZW5kcG9pbnRzXG4gKiBUaGlzIGZpbGUgaXMgdGhlIGVudHJ5IHBvaW50IGZvciB0aGUgTGFtYmRhIGZ1bmN0aW9uIGluIHRoZSB2YWxpZGF0aW9uIHBpcGVsaW5lXG4gKi9cblxuLy8gUmUtZXhwb3J0IHRoZSBoYW5kbGVyIGZyb20gdmFsaWRhdGlvbi50c1xuZXhwb3J0IHsgaGFuZGxlciB9IGZyb20gJy4vdmFsaWRhdGlvbic7ICJdfQ==