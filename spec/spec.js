/* jshint expr: true */

var _ = require('underscore');
var async = require('async');
var should = require('should');
var child_process = require('child_process');
var redis = require('redis');
var assert = require("assert");
var RedisPool = require('../index');

var redisProcess = null;
var client = null;
var clientPool = null;

_.each({
  shouldBeOk: function() {
    var cb = this, error = new Error();

    return function(e, res) {
      try {
        res.should.be.ok;
        cb(e, res);
      } catch(err) {
        error.message = err.message;
        throw error;
      }
    };
  },

  shouldNotBeOk: function() {
    var cb = this, error = new Error();

    return function(e, res) {
      try {
        res.should.not.be.ok;
        cb(e, res);
      } catch(err) {
        error.message = err.message;
        throw error;
      }
    };
  }
}, function(getter, key) {
  Object.defineProperty(Function.prototype, key, { get: getter });
});

_.each({
  shouldEql: function(val) {
    var cb = this, error = new Error();

    return function(e, res) {
      try {
        res.should.eql(val);
        cb(e, res);
      } catch(err) {
        error.message = err.message;
        throw error;
      }
    };
  },
  shouldEqual: function(val) {
    var cb = this, error = new Error();

    return function(e, res) {
      try {
        res.should.equal(val);
        cb(e, res);
      } catch(err) {
        error.message = err.message;
        throw error;
      }
    };
  },
}, function(value, key) {
  Object.defineProperty(Function.prototype, key, { value: value });
});

before(function() {
  redisProcess = child_process.exec(
    'redis-server redis.conf',
    { cwd: __dirname },
    function (error, stdout, stderr) {
      console.log('stdout: ' + stdout);
      console.log('stderr: ' + stderr);
      if (error !== null) {
        console.log('exec error: ' + error);
        throw error;
      }
    });
});

beforeEach(function(done) {
  client = redis.createClient(2229, 'localhost', {});
  clientPool = RedisPool.createPool({port: 2229});

  var errorHandler = function(error) {
    if (/ECONNREFUSED$/.test(error.toString())) {
      // Ignore: the server isn't up yet.
    } else {
      throw error;
    }
  };
  client.on('error', errorHandler);

  var checkReady = function() {
    if (client.ready) {
      client.removeListener('error', errorHandler);
      // Use a normally unavailable database in an effort to avoid stomping on
      // people's real redis DBs.
      client.select(31, function(err, res) {
        client.flushdb(function(err, res) {
          done();
        });
      });
    } else {
      setImmediate(checkReady);
    }
  };
  checkReady();
});

afterEach(function(done) {
  if (client) {
    async.series([
      client.flushdb.bind(client),
      client.quit.bind(client),
      function(cb) {
        client = null;
        cb(undefined);
      }
    ], done);
  }
});

describe('node_redis works (smoke test)', function() {
  it('should connect', function(done) {
    async.series([
      function(callback) {
        client.keys('*', function(err, res) {
          res.length.should.equal(0);
          callback();
        });
      },
      function(callback) {
        client.set('foo', 'bar', callback);
      },
      function(callback) {
        client.keys('*', function(err, res) {
          res.length.should.equal(1);
          callback();
        });
      }], done);
  });
});

describe('Simple commands work', function() {
  it('get and set', function(done) {
    async.series([
      function(callback) {
        clientPool.keys('*', function(err, res) {
          res.length.should.equal(0);
          callback();
        });
      },
      function(callback) {
        clientPool.set('foo', 'bar', callback);
      },
      function(callback) {
        clientPool.keys('*', function(err, res) {
          res.length.should.equal(1);
          callback();
        });
      }], done);
  });

  it('try running parallel', function(done) {
    async.parallel([
      function(callback) {
        clientPool.hset('foo2', 'bar', 'baz', callback);
      },
      function(callback) {
        clientPool.send_command('hset', ['foo2', 'foo', 'bar'], callback);
      }
    ], function(e, res) {
      should.not.exist(e);

      async.parallel({
        bar: function(callback) {
          clientPool.hget('foo2', 'bar', callback);
        },
        foo: function(callback) {
          clientPool.hget('foo2', ['foo'], callback);
        }
      }, function(e, res) {
        should.not.exist(e);
        res.should.eql({ foo: 'bar', bar: 'baz' });
        done();
      });
    });
  });
});

process.on('exit', function() {
  if (redisProcess) {
    redisProcess.kill();
  }
});
