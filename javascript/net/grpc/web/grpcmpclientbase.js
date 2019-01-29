/**
 *
 * Copyright 2018 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 */
/**
 * @fileoverview gRPC browser client library.
 *
 * Base class for gRPC Web JS clients using the application/grpc-web wire
 * format
 *
 * @author stanleycheung@google.com (Stanley Cheung)
 */
goog.module('grpc.web.GrpcMpClientBase');

goog.module.declareLegacyNamespace();

const AbstractClientBase = goog.require('grpc.web.AbstractClientBase');
const GrpcWebStreamParser = goog.require('grpc.web.GrpcWebStreamParser');
const StatusCode = goog.require('grpc.web.StatusCode');
const googCrypt = goog.require('goog.crypt.base64');

/**
 * Base class for gRPC web client using the application/grpc-web wire format
 * @param {?Object=} opt_options
 * @constructor
 * @implements {AbstractClientBase}
 */
const GrpcMpClientBase = function(opt_options) {
  /**
   * @const
   * @private {string}
   */
  this.format_ = goog.getObjectByName('format', opt_options) || "text";
  /**
   * @const
   * @private {Object}
   */
  this.request_ = goog.getObjectByName('request', opt_options);
};

GrpcMpClientBase.prototype.parser_ = new GrpcWebStreamParser();

GrpcMpClientBase.prototype.rpcCall = function(method, request, metadata, methodInfo, callback) {
  let data = [].slice.call(this.encodeRequest(request.serializeBinary()));
  let contentType = this.format_ == 'text' ? 'application/grpc-web-text': 'application/grpc-web+proto';
  let requestData = this.format_ == 'text' ? googCrypt.encodeByteArray(data) : data.map(item => String.fromCharCode(item)).join('');
  let dataType = this.format_ == 'text' ? 'text' : 'arraybuffer';
  this.request_.request({
    method: 'POST',
    header: {
      accept: contentType,
      'content-type': contentType,
      'X-Grpc-Web': '1',
      'X-User-Agent': 'grpc-web-javascript/0.1'
    },
    dataType: dataType,
    responseType: dataType,
    data: requestData,
    url: method,
    success: res => {
      this.decodeResponse(res, methodInfo.responseDeserializeFn, callback);
    },
    fail: res => {
      callback({ message: res.errMsg }, null);
    }
  });
};

GrpcMpClientBase.prototype.serverStreaming = function(method, request, metadata, methodInfo) {}

GrpcMpClientBase.prototype.encodeRequest_ = function(serialized) {
  var len = serialized.length;
  var bytesArray = [0, 0, 0, 0];
  var payload = new Uint8Array(5 + len);
  for (var i = 3; i >= 0; i--) {
    bytesArray[i] = (len % 256);
    len = len >>> 8;
  }
  payload.set(new Uint8Array(bytesArray), 1);
  payload.set(serialized, 5);
  return payload;
};

GrpcMpClientBase.prototype.parseHttp1Headers_ = function(str) {
  var chunks = str.trim().split('\r\n');
  var headers = {};
  for (var i = 0; i < chunks.length; i++) {
    var pos = chunks[i].indexOf(':');
    headers[chunks[i].substring(0, pos).trim()] = chunks[i]
      .substring(pos + 1)
      .trim();
  }
  return headers;
};

GrpcMpClientBase.prototype.encodeRequest = function(serialized) {
  var len = serialized.length;
  var bytesArray = [0, 0, 0, 0];
  var payload = new Uint8Array(5 + len);
  for (var i = 3; i >= 0; i--) {
    bytesArray[i] = len % 256;
    len = len >>> 8;
  }
  payload.set(new Uint8Array(bytesArray), 1);
  payload.set(serialized, 5);
  return payload;
};

GrpcMpClientBase.prototype.decodeResponse = function(res, responseDeserializeFn_, callback) {
  let { data, statusCode, header } = res;
  const GRPC_STATUS = 'grpc-status';
  const GRPC_STATUS_MESSAGE = 'grpc-message';
  var grpcStatusCode = header[GRPC_STATUS];
  var grpcStatusMessage = header[GRPC_STATUS_MESSAGE];
  if (grpcStatusCode && grpcStatusMessage) callback({code: Number(grpcStatusCode), message: grpcStatusMessage}, null);
  
  const contentType = 'application/grpc-web-text';
  if (contentType.indexOf('text') > -1) {
    var pos_ = 0;
    var responseText = data;
    var newPos = responseText.length - responseText.length % 4;
    var newData = responseText.substr(pos_, newPos - pos_);
    if (newData.length == 0) return;
    pos_ = newPos;
    var byteSource = [].slice.call(
      googCrypt.decodeStringToUint8Array(data)
    );
  } else {
    var byteSource = [].slice.call(new Uint8Array(data));
  }

  var messages = this.parser_.parse(byteSource);
  if (!messages) return;

  const FrameType = module$contents$grpc$web$GrpcWebStreamParser_FrameType;
  for (var i = 0; i < messages.length; i++) {
    if (FrameType.DATA in messages[i]) {
      data = messages[i][FrameType.DATA];
      if (data) callback(null, responseDeserializeFn_(data));
    }
    if (FrameType.TRAILER in messages[i]) {
      if (messages[i][FrameType.TRAILER].length > 0) {
        var trailerString = '';
        for (var pos = 0; pos < messages[i][FrameType.TRAILER].length; pos++) {
          trailerString += String.fromCharCode(
            messages[i][FrameType.TRAILER][pos]
          );
        }
        var trailers = this.parseHttp1Headers_(trailerString);
        grpcStatusCode = module$contents$grpc$web$StatusCode_StatusCode.OK;
        grpcStatusMessage = '';
        if (GRPC_STATUS in trailers) {
          grpcStatusCode = trailers[GRPC_STATUS];
        }
        if (GRPC_STATUS_MESSAGE in trailers) {
          grpcStatusMessage = trailers[GRPC_STATUS_MESSAGE];
        }
        callback({code: Number(grpcStatusCode), message: grpcStatusMessage}, null);
      }
    }
  }
  return messages;
};

exports = GrpcMpClientBase;
