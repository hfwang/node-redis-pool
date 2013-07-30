var redis = require('redis');
var commands = require('./lib/commands');
var Pool = require('generic-pool').Pool;

var RedisPool = function RedisPool(options) {
  options.host = options.host || 'localhost';
  options.port = options.port || 6379;
  options.redis_options = options.redis_options || {};

  options.max = options.max || 4;
  options.idleTimeoutMillis = options.idleTimeoutMillis || 10000;
  options.reapIntervalMillis = options.reapIntervalMillis || 1000;
  options.log = ('log' in options) ? options.log : false;

  var host_arg = options.host;
  var port_arg = options.port;
  var redis_options = options.redis_options;

  this.pool = Pool({
    name: "redis://" + host_arg + ":" + port_arg,
    create: function(callback) {
      var client = redis.createClient(port_arg, host_arg, redis_options);
      client.on('ready', function() {
        callback(client);
      });
    },
    destroy: function(client) {
      return client.quit();
    },
    max: options.max,
    idleTimeoutMillis: options.idleTimeoutMillis,
    reapIntervalMillis: options.reapIntervalMillis
  });
  this.options = options;
};
module.exports = exports = RedisPool;

RedisPool.prototype.pool = null;
RedisPool.prototype.options = {};

RedisPool.prototype.send_command = function(command, args, callback) {
  // This is disgusting, but copy/paste the parts of send_command's
  // implementation that normalizes arguments. Shame.

  var last_arg_type;
  if (typeof command !== "string") {
    throw new Error("First argument to send_command must be the command name string, not " + typeof command);
  }

  if (Array.isArray(args)) {
    if (typeof callback === "function") {
      // probably the fastest way:
      //     client.command([arg1, arg2], cb);  (straight passthrough)
      //         send_command(command, [arg1, arg2], cb);
    } else if (! callback) {
      // most people find this variable argument length form more convenient, but it uses arguments, which is slower
      //     client.command(arg1, arg2, cb);   (wraps up arguments into an array)
      //       send_command(command, [arg1, arg2, cb]);
      //     client.command(arg1, arg2);   (callback is optional)
      //       send_command(command, [arg1, arg2]);
      //     client.command(arg1, arg2, undefined);   (callback is undefined)
      //       send_command(command, [arg1, arg2, undefined]);
      last_arg_type = typeof args[args.length - 1];
      if (last_arg_type === "function" || last_arg_type === "undefined") {
        callback = args.pop();
      }
    } else {
      throw new Error("send_command: last argument must be a callback or undefined");
    }
  } else {
    throw new Error("send_command: second argument must be an array");
  }

  // Done copy/pasting: now time to do our own, original work.
  var pool = this.pool;
  pool.acquire(function(err, client) {
    if (err) return callback && callback(err);

    client.send_command(command, args, function(err) {
      pool.release(client);

      if (err) return callback && callback(err);

      if (callback) callback.apply(null, arguments);
    });
  });
};

// Copy over all the commands.
commands.forEach(function(fullCommand) {
  var command = fullCommand.split(' ')[0];
  RedisPool.prototype[command] = redis.RedisClient.prototype[command];
  RedisPool.prototype[command.toUpperCase()] = redis.RedisClient.prototype[command];
});

exports.createPool = function(options) {
  return new RedisPool(options);
};
