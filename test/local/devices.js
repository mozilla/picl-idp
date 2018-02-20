/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

const assert = require("../assert")
var uuid = require('uuid')
var crypto = require('crypto')
const mocks = require('../mocks')

const modulePath = '../../lib/devices'

describe('devices', () => {
  it('should export the correct interface', () => {
    assert.equal(typeof require(modulePath), 'function', 'require returns function')
    assert.equal(require(modulePath).length, 3, 'returned function expects three arguments')
    assert.equal(typeof require(modulePath).schema, 'object', 'devices.schema is object')
    assert.notEqual(require(modulePath).schema, null, 'devices.schema is not null')
  })

  describe('instance', () => {

    var log, deviceCreatedAt, deviceId, device, db, push, devices

    beforeEach(() => {
      log = mocks.mockLog()
      deviceCreatedAt = Date.now()
      deviceId = crypto.randomBytes(16).toString('hex')
      device = {
        name: 'foo',
        type: 'bar'
      }
      db = mocks.mockDB({
        device: device,
        deviceCreatedAt: deviceCreatedAt,
        deviceId: deviceId
      })
      push = mocks.mockPush()
      devices = require(modulePath)(log, db, push)
    })

    it('should instantiate', () => {

      assert.equal(typeof devices, 'object', 'devices is object')
      assert.equal(Object.keys(devices).length, 2, 'devices has two properties')

      assert.equal(typeof devices.upsert, 'function', 'devices has upsert method')
      assert.equal(devices.upsert.length, 3, 'devices.upsert expects three arguments')

      assert.equal(typeof devices.synthesizeName, 'function', 'devices has synthesizeName method')
      assert.equal(devices.synthesizeName.length, 1, 'devices.synthesizeName expects 1 argument')

    })

    describe('.upsert', () => {

      var request, sessionToken

      beforeEach(() => {
        request = mocks.mockRequest({
          log: log
        })
        sessionToken = {
          id: crypto.randomBytes(16).toString('hex'),
          uid: uuid.v4('binary').toString('hex'),
          tokenVerified: true
        }
      })

      it('should create', () => {
        return devices.upsert(request, sessionToken, device)
          .then(function (result) {
          assert.deepEqual(result, {
            id: deviceId,
            name: device.name,
            type: device.type,
            createdAt: deviceCreatedAt
          }, 'result was correct')

          assert.notCalled(db.updateDevice)

          assert.calledOnce(db.createDevice)
          assert.calledWithExactly(db.createDevice, sessionToken.uid, sessionToken.id, device)

          assert.calledOnce(log.activityEvent)
          assert.calledWithExactly(log.activityEvent, {
            event: 'device.created',
            service: undefined,
            userAgent: 'test user-agent',
            uid: sessionToken.uid,
            device_id: deviceId,
            is_placeholder: false
          })

          assert.notCalled(log.info)

          assert.calledOnce(log.notifyAttachedServices)
          assert.calledWithExactly(log.notifyAttachedServices, 'device:create', request, {
            uid: sessionToken.uid,
            id: deviceId,
            type: device.type,
            timestamp: deviceCreatedAt,
            isPlaceholder: false
          })

          assert.calledOnce(push.notifyDeviceConnected)
          args = push.notifyDeviceConnected.args[0]
          assert.equal(args.length, 4, 'push.notifyDeviceConnected was passed four arguments')
          assert.equal(args[0], sessionToken.uid, 'first argument was uid')
          assert.ok(Array.isArray(args[1]), 'second argument was devices array')
          assert.equal(args[2], device.name, 'third arguent was device name')
          assert.equal(args[3], deviceId, 'fourth argument was device id')
        });
      })

      it('should not call notifyDeviceConnected with unverified token', () => {
        sessionToken.tokenVerified = false
        device.name = 'device with an unverified sessionToken'
        return devices.upsert(request, sessionToken, device)
          .then(function () {
            assert.notCalled(push.notifyDeviceConnected)
            sessionToken.tokenVerified = true
          });
      })

      it('should create placeholders', () => {
        delete device.name
        return devices.upsert(request, sessionToken, { uaBrowser: 'Firefox' })
          .then(function (result) {
            assert.notCalled(db.updateDevice)
            assert.calledOnce(db.createDevice)

            assert.calledOnce(log.activityEvent)
            assert.equal(log.activityEvent.args[0][0].is_placeholder, true, 'is_placeholder was correct')

            assert.calledOnce(log.info)
            assert.equal(log.info.args[0].length, 1, 'log.info was passed one argument')
            assert.deepEqual(log.info.args[0][0], {
              op: 'device:createPlaceholder',
              uid: sessionToken.uid,
              id: result.id
            }, 'argument was event data')

            assert.calledOnce(log.notifyAttachedServices)
            assert.equal(log.notifyAttachedServices.args[0][2].isPlaceholder, true, 'isPlaceholder was correct')

            assert.calledOnce(push.notifyDeviceConnected)
            assert.equal(push.notifyDeviceConnected.args[0][0], sessionToken.uid, 'uid was correct')
            assert.equal(push.notifyDeviceConnected.args[0][2], 'Firefox', 'device name was included')

          });
      })

      it('should update', () => {
        var deviceInfo = {
          id: deviceId,
          name: device.name,
          type: device.type
        }
        return devices.upsert(request, sessionToken, deviceInfo)
          .then(function (result) {
          assert.equal(result, deviceInfo, 'result was correct')

          assert.notCalled(db.createDevice)

          assert.calledOnce(db.updateDevice)
          assert.calledWithExactly(db.updateDevice, sessionToken.uid, sessionToken.id, {
            id: deviceId,
            name: device.name,
            type: device.type
          })

          assert.calledOnce(log.activityEvent)
          assert.calledWithExactly(log.activityEvent, {
            event: 'device.updated',
            service: undefined,
            userAgent: 'test user-agent',
            uid: sessionToken.uid,
            device_id: deviceId,
            is_placeholder: false
          })

          assert.notCalled(log.info)

          assert.notCalled(log.notifyAttachedServices)

          assert.notCalled(push.notifyDeviceConnected)
        });
      })
    })

    it('should synthesizeName', () => {
      assert.equal(devices.synthesizeName({
        uaBrowser: 'foo',
        uaBrowserVersion: 'bar',
        uaOS: 'baz',
        uaOSVersion: 'qux',
        uaFormFactor: 'wibble'
      }), 'foo bar, wibble', 'result is correct when all ua properties are set')

      assert.equal(devices.synthesizeName({
        uaBrowserVersion: 'foo',
        uaOS: 'bar',
        uaOSVersion: 'baz',
        uaFormFactor: 'wibble'
      }), 'wibble', 'result is correct when uaBrowser property is missing')

      assert.equal(devices.synthesizeName({
        uaBrowser: 'foo',
        uaOS: 'bar',
        uaOSVersion: 'baz',
        uaFormFactor: 'wibble'
      }), 'foo, wibble', 'result is correct when uaBrowserVersion property is missing')

      assert.equal(devices.synthesizeName({
        uaBrowser: 'foo',
        uaBrowserVersion: 'bar',
        uaOSVersion: 'baz',
        uaFormFactor: 'wibble'
      }), 'foo bar, wibble', 'result is correct when uaOS property is missing')

      assert.equal(devices.synthesizeName({
        uaBrowser: 'foo',
        uaBrowserVersion: 'bar',
        uaOS: 'baz',
        uaFormFactor: 'wibble'
      }), 'foo bar, wibble', 'result is correct when uaOSVersion property is missing')

      assert.equal(devices.synthesizeName({
        uaBrowser: 'foo',
        uaBrowserVersion: 'bar',
        uaOS: 'baz',
        uaOSVersion: 'qux'
      }), 'foo bar, baz qux', 'result is correct when uaFormFactor property is missing')

      assert.equal(devices.synthesizeName({
        uaOS: 'bar',
        uaFormFactor: 'wibble'
      }), 'wibble', 'result is correct when uaBrowser and uaBrowserVersion properties are missing')

      assert.equal(devices.synthesizeName({
        uaBrowser: 'wibble',
        uaBrowserVersion: 'blee',
        uaOSVersion: 'qux'
      }), 'wibble blee', 'result is correct when uaOS and uaFormFactor properties are missing')

      assert.equal(devices.synthesizeName({
        uaBrowser: 'foo',
        uaBrowserVersion: 'bar',
        uaOS: 'baz'
      }), 'foo bar, baz', 'result is correct when uaOSVersion and uaFormFactor properties are missing')

      assert.equal(devices.synthesizeName({
        uaOS: 'foo'
      }), 'foo', 'result is correct when only uaOS property is present')

      assert.equal(devices.synthesizeName({
        uaFormFactor: 'bar'
      }), 'bar', 'result is correct when only uaFormFactor property is present')

      assert.equal(devices.synthesizeName({
        uaOS: 'foo',
        uaOSVersion: 'bar'
      }), 'foo bar', 'result is correct when only uaOS and uaOSVersion properties are present')

      assert.equal(devices.synthesizeName({
        uaOSVersion: 'foo'
      }), '', 'result defaults to the empty string')
    })
  })
})
