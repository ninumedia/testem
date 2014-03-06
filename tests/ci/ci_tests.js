var fs = require('fs')    
var App = require('../../lib/ci')
var TestReporter = require('../../lib/ci/test_reporters/tap_reporter')
var Config = require('../../lib/config')
var bd = require('bodydouble')
var mock = bd.mock
var stub = bd.stub
var path = require('path')
var assert = require('chai').assert
var Process = require('did_it_work')

describe('ci mode app', function(){

  beforeEach(function(done){
    fs.unlink('tests/fixtures/tape/public/bundle.js', function(){
      done()
    })
  })
  
  it('runs them tests on node, nodetap, and browser', function(done){
    this.timeout(10000)
    var config = new Config('ci', {
      file: 'tests/fixtures/tape/testem.json',
      port: 7358,
      cwd: 'tests/fixtures/tape/',
      launch_in_ci: ['node', 'nodeplain', 'phantomjs']
    })
    config.read(function(){
      var app = new App(config)
      stub(app, 'cleanExit')
      var reporter = stub(app, 'reporter', new TestReporter(true))
      app.start()
      app.cleanExit.once('call', function(){
        var helloWorld = reporter.results.filter(function(r){
          return r.result.name.match(/hello world/)
        })
        var helloBob = reporter.results.filter(function(r){
          return r.result.name.match(/hello bob/)
        })
        var nodePlain = reporter.results.filter(function(r){
          return r.launcher === 'NodePlain'
        })
        assert(helloWorld.every(function(r){
          return r.result.passed
        }), 'hello world should pass')
        
        assert(helloBob.every(function(r){
          return !r.result.passed
        }), 'hello bob should fail')
        
        assert(!nodePlain[0].result.passed, 'node plain should fail')
        
        var launchers = reporter.results.map(function(r){
          return r.launcher
        })
        
        assert.include(launchers, 'Node')
        assert.include(launchers, 'NodePlain')
        assert.include(launchers, 'PhantomJS 1.9')

        assert(reporter.results.length >= 1, 'should have a few launchers') // ball park?
        assert(app.cleanExit.called, 'called process.exit()')
        assert(app.cleanExit.lastCall.args[0], 0)
        done()
      })
      
    })
  })

  it('allows passing in reporter from config', function(){
    var fakeReporter = {}
    var config = new Config('ci', {
      reporter: fakeReporter
    })
    var app = new App(config)
    assert.strictEqual(app.reporter, fakeReporter)
  })

  it('wrapUp reports error to reporter', function(){
    var app = new App(new Config('ci'))
    var reporter = new TestReporter(true)
    stub(app, 'reporter', reporter)
    app.wrapUp(new Error('blarg'))
    assert.equal(reporter.total, 1)
    assert.equal(reporter.pass, 0)
    var result = reporter.results[0].result
    assert.equal(result.name, 'Error')
    assert.equal(result.error.message, 'blarg')
  })

  describe('getExitCode', function(){

    it('returns 0 if all passed', function(){
      var app = new App(new Config('ci'))
      var reporter = { total: 1, pass: 1 }
      stub(app, 'reporter', reporter)
      assert.equal(app.getExitCode(), 0)
    })

    it('returns 1 if fails', function(){
      var app = new App(new Config('ci'))
      var reporter = { total: 1, pass: 0 }
      stub(app, 'reporter', reporter)
      assert.equal(app.getExitCode(), 1)
    })

    it('returns 0 if no tests ran', function(){
      var app = new App(new Config('ci'))
      var reporter = { total: 0, pass: 0 }
      stub(app, 'reporter', reporter)
      assert.equal(app.getExitCode(), 0)
    })

    it('returns 1 if no tests and fail_on_zero_tests config is on', function(){
      var app = new App(new Config('ci', {
        fail_on_zero_tests: true
      }))
      var reporter = { total: 0, pass: 0 }
      stub(app, 'reporter', reporter)
      assert.equal(app.getExitCode(), 1)
    })

  })

})

describe('runHook', function(){

  var fakeP

  beforeEach(function(){
    fakeP = mock(Process(''), {
      fluent: true,
      override: {
        complete: function(callback){
          process.nextTick(function(){
            callback(null)
          })
          return this
        }
      }
    })
  })

  it('runs hook', function(done){
    var config = new Config('ci', null, {
      on_start: 'launch nuclear-missile'
    })
    var app = new App(config)
    stub(app, 'Process').returns(fakeP)
    app.runHook('on_start', function(){
      assert(app.Process.called, 'how come you dont call me?')
      assert.equal(app.Process.lastCall.args, 'launch nuclear-missile')
      done()
    })
  })

  it('runs hook with arguments', function(done){
    var config = new Config('ci', null, {
      on_start: 'launch <type> nuclear-missile'
    })
    var app = new App(config)
    stub(app, 'Process').returns(fakeP)
    app.runHook('on_start', {type: 'soviet'}, function(){
      assert(app.Process.called, 'how come you dont call me?')
      assert.equal(app.Process.lastCall.args, 'launch soviet nuclear-missile')
      done()
    })
  })

  it('runs javascript hook', function(done){
    var config = new Config('ci', null, {
      port: 777,
      on_start: function (cfg, data, callback) {
        assert.equal(cfg.get('port'), 777)
        assert.equal(data.viva, 'la revolucion')
        callback(1)
      }
    })
    var app = new App(config)
    app.runHook('on_start', {viva: 'la revolucion'}, function(error){
      assert.equal(error, 1)
      done()
    })
  })

  it('waits for text', function(done){
    var config = new Config('ci', null, {
      on_start: {
        command: 'launch nuclear-missile',
        wait_for_text: 'launched.'
      }
    })
    var app = new App(config)
    stub(app, 'Process').returns(fakeP)
    app.runHook('on_start', function(){
      assert.equal(app.Process.lastCall.args[0], 'launch nuclear-missile')
      assert.equal(fakeP.goodIfMatches.lastCall.args[0], 'launched.')
      done()
    })
  })

  it('substitutes port and host', function(done){
    var config = new Config('ci', {
      port: 2837,
      host: 'dev.app.com'
    }, {
      on_start: {
        command: 'tunnel <host>:<port> -u <url>'
      }
    })
    var app = new App(config)
    stub(app, 'Process').returns(fakeP)
    app.runHook('on_start', function(){
      assert.equal(app.Process.lastCall.args[0], 
        'tunnel dev.app.com:2837 -u http://dev.app.com:2837/')
      done()
    })
  })

  it('launches via spawn', function(done){
    var config = new Config('ci', null, {
      on_start: {
        exe: 'launch',
        args: ['nuclear-missile', '<port>']
      }
    })
    var app = new App(config)
    stub(app, 'Process').returns(fakeP)
    app.runHook('on_start', function(){
      assert(app.Process.called, 'call Process')
      assert.deepEqual(app.Process.lastCall.args, ['launch', ['nuclear-missile', '7357']])
      done()
    })
  })

  it('dies if neither command or exe specified', function(){
    var config = new Config('ci', null, {
      on_start: {
      }
    })
    var app = new App(config)
    assert.throw(function(){
      app.runHook('on_start', function(){})
    }, 'No command or exe/args specified for hook on_start')
  })

  it('kills on_start process on exit', function(done){
    this.timeout(10000)
    var config = new Config('ci', {
      file: 'tests/fixtures/tape/testem.json',
      port: 7358,
      cwd: 'tests/fixtures/tape/',
      launch_in_ci: ['node']
    })
    config.read(function(){
      config.set('on_start', 'launch missile')
      config.set('before_tests', null)
      var app = new App(config)
      stub(app, 'Process').returns(fakeP)
      var reporter = stub(app, 'reporter', new TestReporter(true))
      stub(app, 'cleanExit')
      app.start()
      app.cleanExit.once('call', function(){
        assert.deepEqual(app.Process.lastCall.args[0], 'launch missile')
        assert(fakeP.kill.called, 'should have killed')
        done()
      })
    })
  })

})