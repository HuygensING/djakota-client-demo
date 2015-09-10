(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.DjakotaTest = f()}})(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
/*!
 * The buffer module from node.js, for the browser.
 *
 * @author   Feross Aboukhadijeh <feross@feross.org> <http://feross.org>
 * @license  MIT
 */

var base64 = require('base64-js')
var ieee754 = require('ieee754')
var isArray = require('is-array')

exports.Buffer = Buffer
exports.SlowBuffer = SlowBuffer
exports.INSPECT_MAX_BYTES = 50
Buffer.poolSize = 8192 // not used by this implementation

var rootParent = {}

/**
 * If `Buffer.TYPED_ARRAY_SUPPORT`:
 *   === true    Use Uint8Array implementation (fastest)
 *   === false   Use Object implementation (most compatible, even IE6)
 *
 * Browsers that support typed arrays are IE 10+, Firefox 4+, Chrome 7+, Safari 5.1+,
 * Opera 11.6+, iOS 4.2+.
 *
 * Due to various browser bugs, sometimes the Object implementation will be used even
 * when the browser supports typed arrays.
 *
 * Note:
 *
 *   - Firefox 4-29 lacks support for adding new properties to `Uint8Array` instances,
 *     See: https://bugzilla.mozilla.org/show_bug.cgi?id=695438.
 *
 *   - Safari 5-7 lacks support for changing the `Object.prototype.constructor` property
 *     on objects.
 *
 *   - Chrome 9-10 is missing the `TypedArray.prototype.subarray` function.
 *
 *   - IE10 has a broken `TypedArray.prototype.subarray` function which returns arrays of
 *     incorrect length in some situations.

 * We detect these buggy browsers and set `Buffer.TYPED_ARRAY_SUPPORT` to `false` so they
 * get the Object implementation, which is slower but behaves correctly.
 */
Buffer.TYPED_ARRAY_SUPPORT = (function () {
  function Bar () {}
  try {
    var arr = new Uint8Array(1)
    arr.foo = function () { return 42 }
    arr.constructor = Bar
    return arr.foo() === 42 && // typed array instances can be augmented
        arr.constructor === Bar && // constructor can be set
        typeof arr.subarray === 'function' && // chrome 9-10 lack `subarray`
        arr.subarray(1, 1).byteLength === 0 // ie10 has broken `subarray`
  } catch (e) {
    return false
  }
})()

function kMaxLength () {
  return Buffer.TYPED_ARRAY_SUPPORT
    ? 0x7fffffff
    : 0x3fffffff
}

/**
 * Class: Buffer
 * =============
 *
 * The Buffer constructor returns instances of `Uint8Array` that are augmented
 * with function properties for all the node `Buffer` API functions. We use
 * `Uint8Array` so that square bracket notation works as expected -- it returns
 * a single octet.
 *
 * By augmenting the instances, we can avoid modifying the `Uint8Array`
 * prototype.
 */
function Buffer (arg) {
  if (!(this instanceof Buffer)) {
    // Avoid going through an ArgumentsAdaptorTrampoline in the common case.
    if (arguments.length > 1) return new Buffer(arg, arguments[1])
    return new Buffer(arg)
  }

  this.length = 0
  this.parent = undefined

  // Common case.
  if (typeof arg === 'number') {
    return fromNumber(this, arg)
  }

  // Slightly less common case.
  if (typeof arg === 'string') {
    return fromString(this, arg, arguments.length > 1 ? arguments[1] : 'utf8')
  }

  // Unusual.
  return fromObject(this, arg)
}

function fromNumber (that, length) {
  that = allocate(that, length < 0 ? 0 : checked(length) | 0)
  if (!Buffer.TYPED_ARRAY_SUPPORT) {
    for (var i = 0; i < length; i++) {
      that[i] = 0
    }
  }
  return that
}

function fromString (that, string, encoding) {
  if (typeof encoding !== 'string' || encoding === '') encoding = 'utf8'

  // Assumption: byteLength() return value is always < kMaxLength.
  var length = byteLength(string, encoding) | 0
  that = allocate(that, length)

  that.write(string, encoding)
  return that
}

function fromObject (that, object) {
  if (Buffer.isBuffer(object)) return fromBuffer(that, object)

  if (isArray(object)) return fromArray(that, object)

  if (object == null) {
    throw new TypeError('must start with number, buffer, array or string')
  }

  if (typeof ArrayBuffer !== 'undefined') {
    if (object.buffer instanceof ArrayBuffer) {
      return fromTypedArray(that, object)
    }
    if (object instanceof ArrayBuffer) {
      return fromArrayBuffer(that, object)
    }
  }

  if (object.length) return fromArrayLike(that, object)

  return fromJsonObject(that, object)
}

function fromBuffer (that, buffer) {
  var length = checked(buffer.length) | 0
  that = allocate(that, length)
  buffer.copy(that, 0, 0, length)
  return that
}

function fromArray (that, array) {
  var length = checked(array.length) | 0
  that = allocate(that, length)
  for (var i = 0; i < length; i += 1) {
    that[i] = array[i] & 255
  }
  return that
}

// Duplicate of fromArray() to keep fromArray() monomorphic.
function fromTypedArray (that, array) {
  var length = checked(array.length) | 0
  that = allocate(that, length)
  // Truncating the elements is probably not what people expect from typed
  // arrays with BYTES_PER_ELEMENT > 1 but it's compatible with the behavior
  // of the old Buffer constructor.
  for (var i = 0; i < length; i += 1) {
    that[i] = array[i] & 255
  }
  return that
}

function fromArrayBuffer (that, array) {
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    // Return an augmented `Uint8Array` instance, for best performance
    array.byteLength
    that = Buffer._augment(new Uint8Array(array))
  } else {
    // Fallback: Return an object instance of the Buffer class
    that = fromTypedArray(that, new Uint8Array(array))
  }
  return that
}

function fromArrayLike (that, array) {
  var length = checked(array.length) | 0
  that = allocate(that, length)
  for (var i = 0; i < length; i += 1) {
    that[i] = array[i] & 255
  }
  return that
}

// Deserialize { type: 'Buffer', data: [1,2,3,...] } into a Buffer object.
// Returns a zero-length buffer for inputs that don't conform to the spec.
function fromJsonObject (that, object) {
  var array
  var length = 0

  if (object.type === 'Buffer' && isArray(object.data)) {
    array = object.data
    length = checked(array.length) | 0
  }
  that = allocate(that, length)

  for (var i = 0; i < length; i += 1) {
    that[i] = array[i] & 255
  }
  return that
}

function allocate (that, length) {
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    // Return an augmented `Uint8Array` instance, for best performance
    that = Buffer._augment(new Uint8Array(length))
  } else {
    // Fallback: Return an object instance of the Buffer class
    that.length = length
    that._isBuffer = true
  }

  var fromPool = length !== 0 && length <= Buffer.poolSize >>> 1
  if (fromPool) that.parent = rootParent

  return that
}

function checked (length) {
  // Note: cannot use `length < kMaxLength` here because that fails when
  // length is NaN (which is otherwise coerced to zero.)
  if (length >= kMaxLength()) {
    throw new RangeError('Attempt to allocate Buffer larger than maximum ' +
                         'size: 0x' + kMaxLength().toString(16) + ' bytes')
  }
  return length | 0
}

function SlowBuffer (subject, encoding) {
  if (!(this instanceof SlowBuffer)) return new SlowBuffer(subject, encoding)

  var buf = new Buffer(subject, encoding)
  delete buf.parent
  return buf
}

Buffer.isBuffer = function isBuffer (b) {
  return !!(b != null && b._isBuffer)
}

Buffer.compare = function compare (a, b) {
  if (!Buffer.isBuffer(a) || !Buffer.isBuffer(b)) {
    throw new TypeError('Arguments must be Buffers')
  }

  if (a === b) return 0

  var x = a.length
  var y = b.length

  var i = 0
  var len = Math.min(x, y)
  while (i < len) {
    if (a[i] !== b[i]) break

    ++i
  }

  if (i !== len) {
    x = a[i]
    y = b[i]
  }

  if (x < y) return -1
  if (y < x) return 1
  return 0
}

Buffer.isEncoding = function isEncoding (encoding) {
  switch (String(encoding).toLowerCase()) {
    case 'hex':
    case 'utf8':
    case 'utf-8':
    case 'ascii':
    case 'binary':
    case 'base64':
    case 'raw':
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      return true
    default:
      return false
  }
}

Buffer.concat = function concat (list, length) {
  if (!isArray(list)) throw new TypeError('list argument must be an Array of Buffers.')

  if (list.length === 0) {
    return new Buffer(0)
  }

  var i
  if (length === undefined) {
    length = 0
    for (i = 0; i < list.length; i++) {
      length += list[i].length
    }
  }

  var buf = new Buffer(length)
  var pos = 0
  for (i = 0; i < list.length; i++) {
    var item = list[i]
    item.copy(buf, pos)
    pos += item.length
  }
  return buf
}

function byteLength (string, encoding) {
  if (typeof string !== 'string') string = '' + string

  var len = string.length
  if (len === 0) return 0

  // Use a for loop to avoid recursion
  var loweredCase = false
  for (;;) {
    switch (encoding) {
      case 'ascii':
      case 'binary':
      // Deprecated
      case 'raw':
      case 'raws':
        return len
      case 'utf8':
      case 'utf-8':
        return utf8ToBytes(string).length
      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return len * 2
      case 'hex':
        return len >>> 1
      case 'base64':
        return base64ToBytes(string).length
      default:
        if (loweredCase) return utf8ToBytes(string).length // assume utf8
        encoding = ('' + encoding).toLowerCase()
        loweredCase = true
    }
  }
}
Buffer.byteLength = byteLength

// pre-set for values that may exist in the future
Buffer.prototype.length = undefined
Buffer.prototype.parent = undefined

function slowToString (encoding, start, end) {
  var loweredCase = false

  start = start | 0
  end = end === undefined || end === Infinity ? this.length : end | 0

  if (!encoding) encoding = 'utf8'
  if (start < 0) start = 0
  if (end > this.length) end = this.length
  if (end <= start) return ''

  while (true) {
    switch (encoding) {
      case 'hex':
        return hexSlice(this, start, end)

      case 'utf8':
      case 'utf-8':
        return utf8Slice(this, start, end)

      case 'ascii':
        return asciiSlice(this, start, end)

      case 'binary':
        return binarySlice(this, start, end)

      case 'base64':
        return base64Slice(this, start, end)

      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return utf16leSlice(this, start, end)

      default:
        if (loweredCase) throw new TypeError('Unknown encoding: ' + encoding)
        encoding = (encoding + '').toLowerCase()
        loweredCase = true
    }
  }
}

Buffer.prototype.toString = function toString () {
  var length = this.length | 0
  if (length === 0) return ''
  if (arguments.length === 0) return utf8Slice(this, 0, length)
  return slowToString.apply(this, arguments)
}

Buffer.prototype.equals = function equals (b) {
  if (!Buffer.isBuffer(b)) throw new TypeError('Argument must be a Buffer')
  if (this === b) return true
  return Buffer.compare(this, b) === 0
}

Buffer.prototype.inspect = function inspect () {
  var str = ''
  var max = exports.INSPECT_MAX_BYTES
  if (this.length > 0) {
    str = this.toString('hex', 0, max).match(/.{2}/g).join(' ')
    if (this.length > max) str += ' ... '
  }
  return '<Buffer ' + str + '>'
}

Buffer.prototype.compare = function compare (b) {
  if (!Buffer.isBuffer(b)) throw new TypeError('Argument must be a Buffer')
  if (this === b) return 0
  return Buffer.compare(this, b)
}

Buffer.prototype.indexOf = function indexOf (val, byteOffset) {
  if (byteOffset > 0x7fffffff) byteOffset = 0x7fffffff
  else if (byteOffset < -0x80000000) byteOffset = -0x80000000
  byteOffset >>= 0

  if (this.length === 0) return -1
  if (byteOffset >= this.length) return -1

  // Negative offsets start from the end of the buffer
  if (byteOffset < 0) byteOffset = Math.max(this.length + byteOffset, 0)

  if (typeof val === 'string') {
    if (val.length === 0) return -1 // special case: looking for empty string always fails
    return String.prototype.indexOf.call(this, val, byteOffset)
  }
  if (Buffer.isBuffer(val)) {
    return arrayIndexOf(this, val, byteOffset)
  }
  if (typeof val === 'number') {
    if (Buffer.TYPED_ARRAY_SUPPORT && Uint8Array.prototype.indexOf === 'function') {
      return Uint8Array.prototype.indexOf.call(this, val, byteOffset)
    }
    return arrayIndexOf(this, [ val ], byteOffset)
  }

  function arrayIndexOf (arr, val, byteOffset) {
    var foundIndex = -1
    for (var i = 0; byteOffset + i < arr.length; i++) {
      if (arr[byteOffset + i] === val[foundIndex === -1 ? 0 : i - foundIndex]) {
        if (foundIndex === -1) foundIndex = i
        if (i - foundIndex + 1 === val.length) return byteOffset + foundIndex
      } else {
        foundIndex = -1
      }
    }
    return -1
  }

  throw new TypeError('val must be string, number or Buffer')
}

// `get` is deprecated
Buffer.prototype.get = function get (offset) {
  console.log('.get() is deprecated. Access using array indexes instead.')
  return this.readUInt8(offset)
}

// `set` is deprecated
Buffer.prototype.set = function set (v, offset) {
  console.log('.set() is deprecated. Access using array indexes instead.')
  return this.writeUInt8(v, offset)
}

function hexWrite (buf, string, offset, length) {
  offset = Number(offset) || 0
  var remaining = buf.length - offset
  if (!length) {
    length = remaining
  } else {
    length = Number(length)
    if (length > remaining) {
      length = remaining
    }
  }

  // must be an even number of digits
  var strLen = string.length
  if (strLen % 2 !== 0) throw new Error('Invalid hex string')

  if (length > strLen / 2) {
    length = strLen / 2
  }
  for (var i = 0; i < length; i++) {
    var parsed = parseInt(string.substr(i * 2, 2), 16)
    if (isNaN(parsed)) throw new Error('Invalid hex string')
    buf[offset + i] = parsed
  }
  return i
}

function utf8Write (buf, string, offset, length) {
  return blitBuffer(utf8ToBytes(string, buf.length - offset), buf, offset, length)
}

function asciiWrite (buf, string, offset, length) {
  return blitBuffer(asciiToBytes(string), buf, offset, length)
}

function binaryWrite (buf, string, offset, length) {
  return asciiWrite(buf, string, offset, length)
}

function base64Write (buf, string, offset, length) {
  return blitBuffer(base64ToBytes(string), buf, offset, length)
}

function ucs2Write (buf, string, offset, length) {
  return blitBuffer(utf16leToBytes(string, buf.length - offset), buf, offset, length)
}

Buffer.prototype.write = function write (string, offset, length, encoding) {
  // Buffer#write(string)
  if (offset === undefined) {
    encoding = 'utf8'
    length = this.length
    offset = 0
  // Buffer#write(string, encoding)
  } else if (length === undefined && typeof offset === 'string') {
    encoding = offset
    length = this.length
    offset = 0
  // Buffer#write(string, offset[, length][, encoding])
  } else if (isFinite(offset)) {
    offset = offset | 0
    if (isFinite(length)) {
      length = length | 0
      if (encoding === undefined) encoding = 'utf8'
    } else {
      encoding = length
      length = undefined
    }
  // legacy write(string, encoding, offset, length) - remove in v0.13
  } else {
    var swap = encoding
    encoding = offset
    offset = length | 0
    length = swap
  }

  var remaining = this.length - offset
  if (length === undefined || length > remaining) length = remaining

  if ((string.length > 0 && (length < 0 || offset < 0)) || offset > this.length) {
    throw new RangeError('attempt to write outside buffer bounds')
  }

  if (!encoding) encoding = 'utf8'

  var loweredCase = false
  for (;;) {
    switch (encoding) {
      case 'hex':
        return hexWrite(this, string, offset, length)

      case 'utf8':
      case 'utf-8':
        return utf8Write(this, string, offset, length)

      case 'ascii':
        return asciiWrite(this, string, offset, length)

      case 'binary':
        return binaryWrite(this, string, offset, length)

      case 'base64':
        // Warning: maxLength not taken into account in base64Write
        return base64Write(this, string, offset, length)

      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return ucs2Write(this, string, offset, length)

      default:
        if (loweredCase) throw new TypeError('Unknown encoding: ' + encoding)
        encoding = ('' + encoding).toLowerCase()
        loweredCase = true
    }
  }
}

Buffer.prototype.toJSON = function toJSON () {
  return {
    type: 'Buffer',
    data: Array.prototype.slice.call(this._arr || this, 0)
  }
}

function base64Slice (buf, start, end) {
  if (start === 0 && end === buf.length) {
    return base64.fromByteArray(buf)
  } else {
    return base64.fromByteArray(buf.slice(start, end))
  }
}

function utf8Slice (buf, start, end) {
  end = Math.min(buf.length, end)
  var res = []

  var i = start
  while (i < end) {
    var firstByte = buf[i]
    var codePoint = null
    var bytesPerSequence = (firstByte > 0xEF) ? 4
      : (firstByte > 0xDF) ? 3
      : (firstByte > 0xBF) ? 2
      : 1

    if (i + bytesPerSequence <= end) {
      var secondByte, thirdByte, fourthByte, tempCodePoint

      switch (bytesPerSequence) {
        case 1:
          if (firstByte < 0x80) {
            codePoint = firstByte
          }
          break
        case 2:
          secondByte = buf[i + 1]
          if ((secondByte & 0xC0) === 0x80) {
            tempCodePoint = (firstByte & 0x1F) << 0x6 | (secondByte & 0x3F)
            if (tempCodePoint > 0x7F) {
              codePoint = tempCodePoint
            }
          }
          break
        case 3:
          secondByte = buf[i + 1]
          thirdByte = buf[i + 2]
          if ((secondByte & 0xC0) === 0x80 && (thirdByte & 0xC0) === 0x80) {
            tempCodePoint = (firstByte & 0xF) << 0xC | (secondByte & 0x3F) << 0x6 | (thirdByte & 0x3F)
            if (tempCodePoint > 0x7FF && (tempCodePoint < 0xD800 || tempCodePoint > 0xDFFF)) {
              codePoint = tempCodePoint
            }
          }
          break
        case 4:
          secondByte = buf[i + 1]
          thirdByte = buf[i + 2]
          fourthByte = buf[i + 3]
          if ((secondByte & 0xC0) === 0x80 && (thirdByte & 0xC0) === 0x80 && (fourthByte & 0xC0) === 0x80) {
            tempCodePoint = (firstByte & 0xF) << 0x12 | (secondByte & 0x3F) << 0xC | (thirdByte & 0x3F) << 0x6 | (fourthByte & 0x3F)
            if (tempCodePoint > 0xFFFF && tempCodePoint < 0x110000) {
              codePoint = tempCodePoint
            }
          }
      }
    }

    if (codePoint === null) {
      // we did not generate a valid codePoint so insert a
      // replacement char (U+FFFD) and advance only 1 byte
      codePoint = 0xFFFD
      bytesPerSequence = 1
    } else if (codePoint > 0xFFFF) {
      // encode to utf16 (surrogate pair dance)
      codePoint -= 0x10000
      res.push(codePoint >>> 10 & 0x3FF | 0xD800)
      codePoint = 0xDC00 | codePoint & 0x3FF
    }

    res.push(codePoint)
    i += bytesPerSequence
  }

  return decodeCodePointsArray(res)
}

// Based on http://stackoverflow.com/a/22747272/680742, the browser with
// the lowest limit is Chrome, with 0x10000 args.
// We go 1 magnitude less, for safety
var MAX_ARGUMENTS_LENGTH = 0x1000

function decodeCodePointsArray (codePoints) {
  var len = codePoints.length
  if (len <= MAX_ARGUMENTS_LENGTH) {
    return String.fromCharCode.apply(String, codePoints) // avoid extra slice()
  }

  // Decode in chunks to avoid "call stack size exceeded".
  var res = ''
  var i = 0
  while (i < len) {
    res += String.fromCharCode.apply(
      String,
      codePoints.slice(i, i += MAX_ARGUMENTS_LENGTH)
    )
  }
  return res
}

function asciiSlice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; i++) {
    ret += String.fromCharCode(buf[i] & 0x7F)
  }
  return ret
}

function binarySlice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; i++) {
    ret += String.fromCharCode(buf[i])
  }
  return ret
}

function hexSlice (buf, start, end) {
  var len = buf.length

  if (!start || start < 0) start = 0
  if (!end || end < 0 || end > len) end = len

  var out = ''
  for (var i = start; i < end; i++) {
    out += toHex(buf[i])
  }
  return out
}

function utf16leSlice (buf, start, end) {
  var bytes = buf.slice(start, end)
  var res = ''
  for (var i = 0; i < bytes.length; i += 2) {
    res += String.fromCharCode(bytes[i] + bytes[i + 1] * 256)
  }
  return res
}

Buffer.prototype.slice = function slice (start, end) {
  var len = this.length
  start = ~~start
  end = end === undefined ? len : ~~end

  if (start < 0) {
    start += len
    if (start < 0) start = 0
  } else if (start > len) {
    start = len
  }

  if (end < 0) {
    end += len
    if (end < 0) end = 0
  } else if (end > len) {
    end = len
  }

  if (end < start) end = start

  var newBuf
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    newBuf = Buffer._augment(this.subarray(start, end))
  } else {
    var sliceLen = end - start
    newBuf = new Buffer(sliceLen, undefined)
    for (var i = 0; i < sliceLen; i++) {
      newBuf[i] = this[i + start]
    }
  }

  if (newBuf.length) newBuf.parent = this.parent || this

  return newBuf
}

/*
 * Need to make sure that buffer isn't trying to write out of bounds.
 */
function checkOffset (offset, ext, length) {
  if ((offset % 1) !== 0 || offset < 0) throw new RangeError('offset is not uint')
  if (offset + ext > length) throw new RangeError('Trying to access beyond buffer length')
}

Buffer.prototype.readUIntLE = function readUIntLE (offset, byteLength, noAssert) {
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var val = this[offset]
  var mul = 1
  var i = 0
  while (++i < byteLength && (mul *= 0x100)) {
    val += this[offset + i] * mul
  }

  return val
}

Buffer.prototype.readUIntBE = function readUIntBE (offset, byteLength, noAssert) {
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) {
    checkOffset(offset, byteLength, this.length)
  }

  var val = this[offset + --byteLength]
  var mul = 1
  while (byteLength > 0 && (mul *= 0x100)) {
    val += this[offset + --byteLength] * mul
  }

  return val
}

Buffer.prototype.readUInt8 = function readUInt8 (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 1, this.length)
  return this[offset]
}

Buffer.prototype.readUInt16LE = function readUInt16LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  return this[offset] | (this[offset + 1] << 8)
}

Buffer.prototype.readUInt16BE = function readUInt16BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  return (this[offset] << 8) | this[offset + 1]
}

Buffer.prototype.readUInt32LE = function readUInt32LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return ((this[offset]) |
      (this[offset + 1] << 8) |
      (this[offset + 2] << 16)) +
      (this[offset + 3] * 0x1000000)
}

Buffer.prototype.readUInt32BE = function readUInt32BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset] * 0x1000000) +
    ((this[offset + 1] << 16) |
    (this[offset + 2] << 8) |
    this[offset + 3])
}

Buffer.prototype.readIntLE = function readIntLE (offset, byteLength, noAssert) {
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var val = this[offset]
  var mul = 1
  var i = 0
  while (++i < byteLength && (mul *= 0x100)) {
    val += this[offset + i] * mul
  }
  mul *= 0x80

  if (val >= mul) val -= Math.pow(2, 8 * byteLength)

  return val
}

Buffer.prototype.readIntBE = function readIntBE (offset, byteLength, noAssert) {
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var i = byteLength
  var mul = 1
  var val = this[offset + --i]
  while (i > 0 && (mul *= 0x100)) {
    val += this[offset + --i] * mul
  }
  mul *= 0x80

  if (val >= mul) val -= Math.pow(2, 8 * byteLength)

  return val
}

Buffer.prototype.readInt8 = function readInt8 (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 1, this.length)
  if (!(this[offset] & 0x80)) return (this[offset])
  return ((0xff - this[offset] + 1) * -1)
}

Buffer.prototype.readInt16LE = function readInt16LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  var val = this[offset] | (this[offset + 1] << 8)
  return (val & 0x8000) ? val | 0xFFFF0000 : val
}

Buffer.prototype.readInt16BE = function readInt16BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  var val = this[offset + 1] | (this[offset] << 8)
  return (val & 0x8000) ? val | 0xFFFF0000 : val
}

Buffer.prototype.readInt32LE = function readInt32LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset]) |
    (this[offset + 1] << 8) |
    (this[offset + 2] << 16) |
    (this[offset + 3] << 24)
}

Buffer.prototype.readInt32BE = function readInt32BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset] << 24) |
    (this[offset + 1] << 16) |
    (this[offset + 2] << 8) |
    (this[offset + 3])
}

Buffer.prototype.readFloatLE = function readFloatLE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)
  return ieee754.read(this, offset, true, 23, 4)
}

Buffer.prototype.readFloatBE = function readFloatBE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)
  return ieee754.read(this, offset, false, 23, 4)
}

Buffer.prototype.readDoubleLE = function readDoubleLE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 8, this.length)
  return ieee754.read(this, offset, true, 52, 8)
}

Buffer.prototype.readDoubleBE = function readDoubleBE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 8, this.length)
  return ieee754.read(this, offset, false, 52, 8)
}

function checkInt (buf, value, offset, ext, max, min) {
  if (!Buffer.isBuffer(buf)) throw new TypeError('buffer must be a Buffer instance')
  if (value > max || value < min) throw new RangeError('value is out of bounds')
  if (offset + ext > buf.length) throw new RangeError('index out of range')
}

Buffer.prototype.writeUIntLE = function writeUIntLE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkInt(this, value, offset, byteLength, Math.pow(2, 8 * byteLength), 0)

  var mul = 1
  var i = 0
  this[offset] = value & 0xFF
  while (++i < byteLength && (mul *= 0x100)) {
    this[offset + i] = (value / mul) & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeUIntBE = function writeUIntBE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkInt(this, value, offset, byteLength, Math.pow(2, 8 * byteLength), 0)

  var i = byteLength - 1
  var mul = 1
  this[offset + i] = value & 0xFF
  while (--i >= 0 && (mul *= 0x100)) {
    this[offset + i] = (value / mul) & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeUInt8 = function writeUInt8 (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 1, 0xff, 0)
  if (!Buffer.TYPED_ARRAY_SUPPORT) value = Math.floor(value)
  this[offset] = value
  return offset + 1
}

function objectWriteUInt16 (buf, value, offset, littleEndian) {
  if (value < 0) value = 0xffff + value + 1
  for (var i = 0, j = Math.min(buf.length - offset, 2); i < j; i++) {
    buf[offset + i] = (value & (0xff << (8 * (littleEndian ? i : 1 - i)))) >>>
      (littleEndian ? i : 1 - i) * 8
  }
}

Buffer.prototype.writeUInt16LE = function writeUInt16LE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 2, 0xffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = value
    this[offset + 1] = (value >>> 8)
  } else {
    objectWriteUInt16(this, value, offset, true)
  }
  return offset + 2
}

Buffer.prototype.writeUInt16BE = function writeUInt16BE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 2, 0xffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 8)
    this[offset + 1] = value
  } else {
    objectWriteUInt16(this, value, offset, false)
  }
  return offset + 2
}

function objectWriteUInt32 (buf, value, offset, littleEndian) {
  if (value < 0) value = 0xffffffff + value + 1
  for (var i = 0, j = Math.min(buf.length - offset, 4); i < j; i++) {
    buf[offset + i] = (value >>> (littleEndian ? i : 3 - i) * 8) & 0xff
  }
}

Buffer.prototype.writeUInt32LE = function writeUInt32LE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset + 3] = (value >>> 24)
    this[offset + 2] = (value >>> 16)
    this[offset + 1] = (value >>> 8)
    this[offset] = value
  } else {
    objectWriteUInt32(this, value, offset, true)
  }
  return offset + 4
}

Buffer.prototype.writeUInt32BE = function writeUInt32BE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 24)
    this[offset + 1] = (value >>> 16)
    this[offset + 2] = (value >>> 8)
    this[offset + 3] = value
  } else {
    objectWriteUInt32(this, value, offset, false)
  }
  return offset + 4
}

Buffer.prototype.writeIntLE = function writeIntLE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) {
    var limit = Math.pow(2, 8 * byteLength - 1)

    checkInt(this, value, offset, byteLength, limit - 1, -limit)
  }

  var i = 0
  var mul = 1
  var sub = value < 0 ? 1 : 0
  this[offset] = value & 0xFF
  while (++i < byteLength && (mul *= 0x100)) {
    this[offset + i] = ((value / mul) >> 0) - sub & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeIntBE = function writeIntBE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) {
    var limit = Math.pow(2, 8 * byteLength - 1)

    checkInt(this, value, offset, byteLength, limit - 1, -limit)
  }

  var i = byteLength - 1
  var mul = 1
  var sub = value < 0 ? 1 : 0
  this[offset + i] = value & 0xFF
  while (--i >= 0 && (mul *= 0x100)) {
    this[offset + i] = ((value / mul) >> 0) - sub & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeInt8 = function writeInt8 (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 1, 0x7f, -0x80)
  if (!Buffer.TYPED_ARRAY_SUPPORT) value = Math.floor(value)
  if (value < 0) value = 0xff + value + 1
  this[offset] = value
  return offset + 1
}

Buffer.prototype.writeInt16LE = function writeInt16LE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = value
    this[offset + 1] = (value >>> 8)
  } else {
    objectWriteUInt16(this, value, offset, true)
  }
  return offset + 2
}

Buffer.prototype.writeInt16BE = function writeInt16BE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 8)
    this[offset + 1] = value
  } else {
    objectWriteUInt16(this, value, offset, false)
  }
  return offset + 2
}

Buffer.prototype.writeInt32LE = function writeInt32LE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = value
    this[offset + 1] = (value >>> 8)
    this[offset + 2] = (value >>> 16)
    this[offset + 3] = (value >>> 24)
  } else {
    objectWriteUInt32(this, value, offset, true)
  }
  return offset + 4
}

Buffer.prototype.writeInt32BE = function writeInt32BE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
  if (value < 0) value = 0xffffffff + value + 1
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 24)
    this[offset + 1] = (value >>> 16)
    this[offset + 2] = (value >>> 8)
    this[offset + 3] = value
  } else {
    objectWriteUInt32(this, value, offset, false)
  }
  return offset + 4
}

function checkIEEE754 (buf, value, offset, ext, max, min) {
  if (value > max || value < min) throw new RangeError('value is out of bounds')
  if (offset + ext > buf.length) throw new RangeError('index out of range')
  if (offset < 0) throw new RangeError('index out of range')
}

function writeFloat (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    checkIEEE754(buf, value, offset, 4, 3.4028234663852886e+38, -3.4028234663852886e+38)
  }
  ieee754.write(buf, value, offset, littleEndian, 23, 4)
  return offset + 4
}

Buffer.prototype.writeFloatLE = function writeFloatLE (value, offset, noAssert) {
  return writeFloat(this, value, offset, true, noAssert)
}

Buffer.prototype.writeFloatBE = function writeFloatBE (value, offset, noAssert) {
  return writeFloat(this, value, offset, false, noAssert)
}

function writeDouble (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    checkIEEE754(buf, value, offset, 8, 1.7976931348623157E+308, -1.7976931348623157E+308)
  }
  ieee754.write(buf, value, offset, littleEndian, 52, 8)
  return offset + 8
}

Buffer.prototype.writeDoubleLE = function writeDoubleLE (value, offset, noAssert) {
  return writeDouble(this, value, offset, true, noAssert)
}

Buffer.prototype.writeDoubleBE = function writeDoubleBE (value, offset, noAssert) {
  return writeDouble(this, value, offset, false, noAssert)
}

// copy(targetBuffer, targetStart=0, sourceStart=0, sourceEnd=buffer.length)
Buffer.prototype.copy = function copy (target, targetStart, start, end) {
  if (!start) start = 0
  if (!end && end !== 0) end = this.length
  if (targetStart >= target.length) targetStart = target.length
  if (!targetStart) targetStart = 0
  if (end > 0 && end < start) end = start

  // Copy 0 bytes; we're done
  if (end === start) return 0
  if (target.length === 0 || this.length === 0) return 0

  // Fatal error conditions
  if (targetStart < 0) {
    throw new RangeError('targetStart out of bounds')
  }
  if (start < 0 || start >= this.length) throw new RangeError('sourceStart out of bounds')
  if (end < 0) throw new RangeError('sourceEnd out of bounds')

  // Are we oob?
  if (end > this.length) end = this.length
  if (target.length - targetStart < end - start) {
    end = target.length - targetStart + start
  }

  var len = end - start
  var i

  if (this === target && start < targetStart && targetStart < end) {
    // descending copy from end
    for (i = len - 1; i >= 0; i--) {
      target[i + targetStart] = this[i + start]
    }
  } else if (len < 1000 || !Buffer.TYPED_ARRAY_SUPPORT) {
    // ascending copy from start
    for (i = 0; i < len; i++) {
      target[i + targetStart] = this[i + start]
    }
  } else {
    target._set(this.subarray(start, start + len), targetStart)
  }

  return len
}

// fill(value, start=0, end=buffer.length)
Buffer.prototype.fill = function fill (value, start, end) {
  if (!value) value = 0
  if (!start) start = 0
  if (!end) end = this.length

  if (end < start) throw new RangeError('end < start')

  // Fill 0 bytes; we're done
  if (end === start) return
  if (this.length === 0) return

  if (start < 0 || start >= this.length) throw new RangeError('start out of bounds')
  if (end < 0 || end > this.length) throw new RangeError('end out of bounds')

  var i
  if (typeof value === 'number') {
    for (i = start; i < end; i++) {
      this[i] = value
    }
  } else {
    var bytes = utf8ToBytes(value.toString())
    var len = bytes.length
    for (i = start; i < end; i++) {
      this[i] = bytes[i % len]
    }
  }

  return this
}

/**
 * Creates a new `ArrayBuffer` with the *copied* memory of the buffer instance.
 * Added in Node 0.12. Only available in browsers that support ArrayBuffer.
 */
Buffer.prototype.toArrayBuffer = function toArrayBuffer () {
  if (typeof Uint8Array !== 'undefined') {
    if (Buffer.TYPED_ARRAY_SUPPORT) {
      return (new Buffer(this)).buffer
    } else {
      var buf = new Uint8Array(this.length)
      for (var i = 0, len = buf.length; i < len; i += 1) {
        buf[i] = this[i]
      }
      return buf.buffer
    }
  } else {
    throw new TypeError('Buffer.toArrayBuffer not supported in this browser')
  }
}

// HELPER FUNCTIONS
// ================

var BP = Buffer.prototype

/**
 * Augment a Uint8Array *instance* (not the Uint8Array class!) with Buffer methods
 */
Buffer._augment = function _augment (arr) {
  arr.constructor = Buffer
  arr._isBuffer = true

  // save reference to original Uint8Array set method before overwriting
  arr._set = arr.set

  // deprecated
  arr.get = BP.get
  arr.set = BP.set

  arr.write = BP.write
  arr.toString = BP.toString
  arr.toLocaleString = BP.toString
  arr.toJSON = BP.toJSON
  arr.equals = BP.equals
  arr.compare = BP.compare
  arr.indexOf = BP.indexOf
  arr.copy = BP.copy
  arr.slice = BP.slice
  arr.readUIntLE = BP.readUIntLE
  arr.readUIntBE = BP.readUIntBE
  arr.readUInt8 = BP.readUInt8
  arr.readUInt16LE = BP.readUInt16LE
  arr.readUInt16BE = BP.readUInt16BE
  arr.readUInt32LE = BP.readUInt32LE
  arr.readUInt32BE = BP.readUInt32BE
  arr.readIntLE = BP.readIntLE
  arr.readIntBE = BP.readIntBE
  arr.readInt8 = BP.readInt8
  arr.readInt16LE = BP.readInt16LE
  arr.readInt16BE = BP.readInt16BE
  arr.readInt32LE = BP.readInt32LE
  arr.readInt32BE = BP.readInt32BE
  arr.readFloatLE = BP.readFloatLE
  arr.readFloatBE = BP.readFloatBE
  arr.readDoubleLE = BP.readDoubleLE
  arr.readDoubleBE = BP.readDoubleBE
  arr.writeUInt8 = BP.writeUInt8
  arr.writeUIntLE = BP.writeUIntLE
  arr.writeUIntBE = BP.writeUIntBE
  arr.writeUInt16LE = BP.writeUInt16LE
  arr.writeUInt16BE = BP.writeUInt16BE
  arr.writeUInt32LE = BP.writeUInt32LE
  arr.writeUInt32BE = BP.writeUInt32BE
  arr.writeIntLE = BP.writeIntLE
  arr.writeIntBE = BP.writeIntBE
  arr.writeInt8 = BP.writeInt8
  arr.writeInt16LE = BP.writeInt16LE
  arr.writeInt16BE = BP.writeInt16BE
  arr.writeInt32LE = BP.writeInt32LE
  arr.writeInt32BE = BP.writeInt32BE
  arr.writeFloatLE = BP.writeFloatLE
  arr.writeFloatBE = BP.writeFloatBE
  arr.writeDoubleLE = BP.writeDoubleLE
  arr.writeDoubleBE = BP.writeDoubleBE
  arr.fill = BP.fill
  arr.inspect = BP.inspect
  arr.toArrayBuffer = BP.toArrayBuffer

  return arr
}

var INVALID_BASE64_RE = /[^+\/0-9A-Za-z-_]/g

function base64clean (str) {
  // Node strips out invalid characters like \n and \t from the string, base64-js does not
  str = stringtrim(str).replace(INVALID_BASE64_RE, '')
  // Node converts strings with length < 2 to ''
  if (str.length < 2) return ''
  // Node allows for non-padded base64 strings (missing trailing ===), base64-js does not
  while (str.length % 4 !== 0) {
    str = str + '='
  }
  return str
}

function stringtrim (str) {
  if (str.trim) return str.trim()
  return str.replace(/^\s+|\s+$/g, '')
}

function toHex (n) {
  if (n < 16) return '0' + n.toString(16)
  return n.toString(16)
}

function utf8ToBytes (string, units) {
  units = units || Infinity
  var codePoint
  var length = string.length
  var leadSurrogate = null
  var bytes = []

  for (var i = 0; i < length; i++) {
    codePoint = string.charCodeAt(i)

    // is surrogate component
    if (codePoint > 0xD7FF && codePoint < 0xE000) {
      // last char was a lead
      if (!leadSurrogate) {
        // no lead yet
        if (codePoint > 0xDBFF) {
          // unexpected trail
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          continue
        } else if (i + 1 === length) {
          // unpaired lead
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          continue
        }

        // valid lead
        leadSurrogate = codePoint

        continue
      }

      // 2 leads in a row
      if (codePoint < 0xDC00) {
        if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
        leadSurrogate = codePoint
        continue
      }

      // valid surrogate pair
      codePoint = leadSurrogate - 0xD800 << 10 | codePoint - 0xDC00 | 0x10000
    } else if (leadSurrogate) {
      // valid bmp char, but last char was a lead
      if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
    }

    leadSurrogate = null

    // encode utf8
    if (codePoint < 0x80) {
      if ((units -= 1) < 0) break
      bytes.push(codePoint)
    } else if (codePoint < 0x800) {
      if ((units -= 2) < 0) break
      bytes.push(
        codePoint >> 0x6 | 0xC0,
        codePoint & 0x3F | 0x80
      )
    } else if (codePoint < 0x10000) {
      if ((units -= 3) < 0) break
      bytes.push(
        codePoint >> 0xC | 0xE0,
        codePoint >> 0x6 & 0x3F | 0x80,
        codePoint & 0x3F | 0x80
      )
    } else if (codePoint < 0x110000) {
      if ((units -= 4) < 0) break
      bytes.push(
        codePoint >> 0x12 | 0xF0,
        codePoint >> 0xC & 0x3F | 0x80,
        codePoint >> 0x6 & 0x3F | 0x80,
        codePoint & 0x3F | 0x80
      )
    } else {
      throw new Error('Invalid code point')
    }
  }

  return bytes
}

function asciiToBytes (str) {
  var byteArray = []
  for (var i = 0; i < str.length; i++) {
    // Node's code seems to be doing this and not & 0x7F..
    byteArray.push(str.charCodeAt(i) & 0xFF)
  }
  return byteArray
}

function utf16leToBytes (str, units) {
  var c, hi, lo
  var byteArray = []
  for (var i = 0; i < str.length; i++) {
    if ((units -= 2) < 0) break

    c = str.charCodeAt(i)
    hi = c >> 8
    lo = c % 256
    byteArray.push(lo)
    byteArray.push(hi)
  }

  return byteArray
}

function base64ToBytes (str) {
  return base64.toByteArray(base64clean(str))
}

function blitBuffer (src, dst, offset, length) {
  for (var i = 0; i < length; i++) {
    if ((i + offset >= dst.length) || (i >= src.length)) break
    dst[i + offset] = src[i]
  }
  return i
}

},{"base64-js":2,"ieee754":3,"is-array":4}],2:[function(require,module,exports){
var lookup = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

;(function (exports) {
	'use strict';

  var Arr = (typeof Uint8Array !== 'undefined')
    ? Uint8Array
    : Array

	var PLUS   = '+'.charCodeAt(0)
	var SLASH  = '/'.charCodeAt(0)
	var NUMBER = '0'.charCodeAt(0)
	var LOWER  = 'a'.charCodeAt(0)
	var UPPER  = 'A'.charCodeAt(0)
	var PLUS_URL_SAFE = '-'.charCodeAt(0)
	var SLASH_URL_SAFE = '_'.charCodeAt(0)

	function decode (elt) {
		var code = elt.charCodeAt(0)
		if (code === PLUS ||
		    code === PLUS_URL_SAFE)
			return 62 // '+'
		if (code === SLASH ||
		    code === SLASH_URL_SAFE)
			return 63 // '/'
		if (code < NUMBER)
			return -1 //no match
		if (code < NUMBER + 10)
			return code - NUMBER + 26 + 26
		if (code < UPPER + 26)
			return code - UPPER
		if (code < LOWER + 26)
			return code - LOWER + 26
	}

	function b64ToByteArray (b64) {
		var i, j, l, tmp, placeHolders, arr

		if (b64.length % 4 > 0) {
			throw new Error('Invalid string. Length must be a multiple of 4')
		}

		// the number of equal signs (place holders)
		// if there are two placeholders, than the two characters before it
		// represent one byte
		// if there is only one, then the three characters before it represent 2 bytes
		// this is just a cheap hack to not do indexOf twice
		var len = b64.length
		placeHolders = '=' === b64.charAt(len - 2) ? 2 : '=' === b64.charAt(len - 1) ? 1 : 0

		// base64 is 4/3 + up to two characters of the original data
		arr = new Arr(b64.length * 3 / 4 - placeHolders)

		// if there are placeholders, only get up to the last complete 4 chars
		l = placeHolders > 0 ? b64.length - 4 : b64.length

		var L = 0

		function push (v) {
			arr[L++] = v
		}

		for (i = 0, j = 0; i < l; i += 4, j += 3) {
			tmp = (decode(b64.charAt(i)) << 18) | (decode(b64.charAt(i + 1)) << 12) | (decode(b64.charAt(i + 2)) << 6) | decode(b64.charAt(i + 3))
			push((tmp & 0xFF0000) >> 16)
			push((tmp & 0xFF00) >> 8)
			push(tmp & 0xFF)
		}

		if (placeHolders === 2) {
			tmp = (decode(b64.charAt(i)) << 2) | (decode(b64.charAt(i + 1)) >> 4)
			push(tmp & 0xFF)
		} else if (placeHolders === 1) {
			tmp = (decode(b64.charAt(i)) << 10) | (decode(b64.charAt(i + 1)) << 4) | (decode(b64.charAt(i + 2)) >> 2)
			push((tmp >> 8) & 0xFF)
			push(tmp & 0xFF)
		}

		return arr
	}

	function uint8ToBase64 (uint8) {
		var i,
			extraBytes = uint8.length % 3, // if we have 1 byte left, pad 2 bytes
			output = "",
			temp, length

		function encode (num) {
			return lookup.charAt(num)
		}

		function tripletToBase64 (num) {
			return encode(num >> 18 & 0x3F) + encode(num >> 12 & 0x3F) + encode(num >> 6 & 0x3F) + encode(num & 0x3F)
		}

		// go through the array every three bytes, we'll deal with trailing stuff later
		for (i = 0, length = uint8.length - extraBytes; i < length; i += 3) {
			temp = (uint8[i] << 16) + (uint8[i + 1] << 8) + (uint8[i + 2])
			output += tripletToBase64(temp)
		}

		// pad the end with zeros, but make sure to not forget the extra bytes
		switch (extraBytes) {
			case 1:
				temp = uint8[uint8.length - 1]
				output += encode(temp >> 2)
				output += encode((temp << 4) & 0x3F)
				output += '=='
				break
			case 2:
				temp = (uint8[uint8.length - 2] << 8) + (uint8[uint8.length - 1])
				output += encode(temp >> 10)
				output += encode((temp >> 4) & 0x3F)
				output += encode((temp << 2) & 0x3F)
				output += '='
				break
		}

		return output
	}

	exports.toByteArray = b64ToByteArray
	exports.fromByteArray = uint8ToBase64
}(typeof exports === 'undefined' ? (this.base64js = {}) : exports))

},{}],3:[function(require,module,exports){
exports.read = function (buffer, offset, isLE, mLen, nBytes) {
  var e, m
  var eLen = nBytes * 8 - mLen - 1
  var eMax = (1 << eLen) - 1
  var eBias = eMax >> 1
  var nBits = -7
  var i = isLE ? (nBytes - 1) : 0
  var d = isLE ? -1 : 1
  var s = buffer[offset + i]

  i += d

  e = s & ((1 << (-nBits)) - 1)
  s >>= (-nBits)
  nBits += eLen
  for (; nBits > 0; e = e * 256 + buffer[offset + i], i += d, nBits -= 8) {}

  m = e & ((1 << (-nBits)) - 1)
  e >>= (-nBits)
  nBits += mLen
  for (; nBits > 0; m = m * 256 + buffer[offset + i], i += d, nBits -= 8) {}

  if (e === 0) {
    e = 1 - eBias
  } else if (e === eMax) {
    return m ? NaN : ((s ? -1 : 1) * Infinity)
  } else {
    m = m + Math.pow(2, mLen)
    e = e - eBias
  }
  return (s ? -1 : 1) * m * Math.pow(2, e - mLen)
}

exports.write = function (buffer, value, offset, isLE, mLen, nBytes) {
  var e, m, c
  var eLen = nBytes * 8 - mLen - 1
  var eMax = (1 << eLen) - 1
  var eBias = eMax >> 1
  var rt = (mLen === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0)
  var i = isLE ? 0 : (nBytes - 1)
  var d = isLE ? 1 : -1
  var s = value < 0 || (value === 0 && 1 / value < 0) ? 1 : 0

  value = Math.abs(value)

  if (isNaN(value) || value === Infinity) {
    m = isNaN(value) ? 1 : 0
    e = eMax
  } else {
    e = Math.floor(Math.log(value) / Math.LN2)
    if (value * (c = Math.pow(2, -e)) < 1) {
      e--
      c *= 2
    }
    if (e + eBias >= 1) {
      value += rt / c
    } else {
      value += rt * Math.pow(2, 1 - eBias)
    }
    if (value * c >= 2) {
      e++
      c /= 2
    }

    if (e + eBias >= eMax) {
      m = 0
      e = eMax
    } else if (e + eBias >= 1) {
      m = (value * c - 1) * Math.pow(2, mLen)
      e = e + eBias
    } else {
      m = value * Math.pow(2, eBias - 1) * Math.pow(2, mLen)
      e = 0
    }
  }

  for (; mLen >= 8; buffer[offset + i] = m & 0xff, i += d, m /= 256, mLen -= 8) {}

  e = (e << mLen) | m
  eLen += mLen
  for (; eLen > 0; buffer[offset + i] = e & 0xff, i += d, e /= 256, eLen -= 8) {}

  buffer[offset + i - d] |= s * 128
}

},{}],4:[function(require,module,exports){

/**
 * isArray
 */

var isArray = Array.isArray;

/**
 * toString
 */

var str = Object.prototype.toString;

/**
 * Whether or not the given `val`
 * is an array.
 *
 * example:
 *
 *        isArray([]);
 *        // > true
 *        isArray(arguments);
 *        // > false
 *        isArray('');
 *        // > false
 *
 * @param {mixed} val
 * @return {bool}
 */

module.exports = isArray || function (val) {
  return !! val && '[object Array]' == str.call(val);
};

},{}],5:[function(require,module,exports){
// shim for using process in browser

var process = module.exports = {};
var queue = [];
var draining = false;
var currentQueue;
var queueIndex = -1;

function cleanUpNextTick() {
    draining = false;
    if (currentQueue.length) {
        queue = currentQueue.concat(queue);
    } else {
        queueIndex = -1;
    }
    if (queue.length) {
        drainQueue();
    }
}

function drainQueue() {
    if (draining) {
        return;
    }
    var timeout = setTimeout(cleanUpNextTick);
    draining = true;

    var len = queue.length;
    while(len) {
        currentQueue = queue;
        queue = [];
        while (++queueIndex < len) {
            if (currentQueue) {
                currentQueue[queueIndex].run();
            }
        }
        queueIndex = -1;
        len = queue.length;
    }
    currentQueue = null;
    draining = false;
    clearTimeout(timeout);
}

process.nextTick = function (fun) {
    var args = new Array(arguments.length - 1);
    if (arguments.length > 1) {
        for (var i = 1; i < arguments.length; i++) {
            args[i - 1] = arguments[i];
        }
    }
    queue.push(new Item(fun, args));
    if (queue.length === 1 && !draining) {
        setTimeout(drainQueue, 0);
    }
};

// v8 likes predictible objects
function Item(fun, array) {
    this.fun = fun;
    this.array = array;
}
Item.prototype.run = function () {
    this.fun.apply(null, this.array);
};
process.title = 'browser';
process.browser = true;
process.env = {};
process.argv = [];
process.version = ''; // empty string to avoid regexp issues
process.versions = {};

function noop() {}

process.on = noop;
process.addListener = noop;
process.once = noop;
process.off = noop;
process.removeListener = noop;
process.removeAllListeners = noop;
process.emit = noop;

process.binding = function (name) {
    throw new Error('process.binding is not supported');
};

process.cwd = function () { return '/' };
process.chdir = function (dir) {
    throw new Error('process.chdir is not supported');
};
process.umask = function() { return 0; };

},{}],6:[function(require,module,exports){
"use strict";

var _createClass = (function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; })();

var _get = function get(_x, _x2, _x3) { var _again = true; _function: while (_again) { var object = _x, property = _x2, receiver = _x3; desc = parent = getter = undefined; _again = false; if (object === null) object = Function.prototype; var desc = Object.getOwnPropertyDescriptor(object, property); if (desc === undefined) { var parent = Object.getPrototypeOf(object); if (parent === null) { return undefined; } else { _x = parent; _x2 = property; _x3 = receiver; _again = true; continue _function; } } else if ("value" in desc) { return desc.value; } else { var getter = desc.get; if (getter === undefined) { return undefined; } return getter.call(receiver); } } };

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { "default": obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

var _react = require("react");

var _react2 = _interopRequireDefault(_react);

var _hireDjakotaClient = require("hire-djakota-client");

var configs = [{ "identifier": "http://localhost:8080/jp2/13434696301791.jp2", "imagefile": "/var/cache/tomcat6/temp/cache15069217286472590195734192754.jp2", "width": "4355", "height": "3300", "dwtLevels": "6", "levels": "6", "compositingLayerCount": "1" }, { "identifier": "http://localhost:8080/jp2/14109682675171.jp2", "imagefile": "/var/cache/tomcat6/temp/cache-13181255252118942660168337691.jp2", "width": "2409", "height": "616", "dwtLevels": "5", "levels": "5", "compositingLayerCount": "1" }, { "identifier": "http://localhost:8080/jp2/14284083156311.jp2", "imagefile": "/var/cache/tomcat6/temp/cache-8322632389065752716911482542.jp2", "width": "758", "height": "4891", "dwtLevels": "6", "levels": "6", "compositingLayerCount": "1" }];

var service = "https://tomcat.tiler01.huygens.knaw.nl/adore-djatoka/resolver";

var App = (function (_React$Component) {
	_inherits(App, _React$Component);

	function App(props) {
		_classCallCheck(this, App);

		_get(Object.getPrototypeOf(App.prototype), "constructor", this).call(this, props);
		this.state = {
			config: configs[0]
		};
	}

	_createClass(App, [{
		key: "render",
		value: function render() {
			return _react2["default"].createElement(
				"div",
				{ className: "app" },
				_react2["default"].createElement(_hireDjakotaClient.DjakotaClient, { config: this.state.config, service: service }),
				_react2["default"].createElement(_hireDjakotaClient.Zoom, null),
				_react2["default"].createElement(_hireDjakotaClient.FillButton, { scaleMode: "widthFill" }),
				_react2["default"].createElement(_hireDjakotaClient.FillButton, { scaleMode: "heightFill" }),
				_react2["default"].createElement(_hireDjakotaClient.FillButton, { scaleMode: "fullZoom" }),
				_react2["default"].createElement(_hireDjakotaClient.FillButton, { scaleMode: "autoFill" }),
				_react2["default"].createElement(_hireDjakotaClient.Minimap, { config: this.state.config, service: service })
			);
		}
	}]);

	return App;
})(_react2["default"].Component);

_react2["default"].render(_react2["default"].createElement(App, null), document.body);

},{"hire-djakota-client":7,"react":"react"}],7:[function(require,module,exports){
(function (process,global,Buffer){
"use strict";

var _extends2 = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; };

(function (f) {
	if (typeof exports === "object" && typeof module !== "undefined") {
		module.exports = f();
	} else if (typeof define === "function" && define.amd) {
		define([], f);
	} else {
		var g;if (typeof window !== "undefined") {
			g = window;
		} else if (typeof global !== "undefined") {
			g = global;
		} else if (typeof self !== "undefined") {
			g = self;
		} else {
			g = this;
		}g.DjakotaClient = f();
	}
})(function () {
	var define, module, exports;return (function e(t, n, r) {
		function s(o, u) {
			if (!n[o]) {
				if (!t[o]) {
					var a = typeof require == "function" && require;if (!u && a) return a(o, !0);if (i) return i(o, !0);var f = new Error("Cannot find module '" + o + "'");throw (f.code = "MODULE_NOT_FOUND", f);
				}var l = n[o] = { exports: {} };t[o][0].call(l.exports, function (e) {
					var n = t[o][1][e];return s(n ? n : e);
				}, l, l.exports, e, t, n, r);
			}return n[o].exports;
		}var i = typeof require == "function" && require;for (var o = 0; o < r.length; o++) s(r[o]);return s;
	})({ 1: [function (_dereq_, module, exports) {
			var inserted = {};

			module.exports = function (css, options) {
				if (inserted[css]) return;
				inserted[css] = true;

				var elem = document.createElement('style');
				elem.setAttribute('type', 'text/css');

				if ('textContent' in elem) {
					elem.textContent = css;
				} else {
					elem.styleSheet.cssText = css;
				}

				var head = document.getElementsByTagName('head')[0];
				if (options && options.prepend) {
					head.insertBefore(elem, head.childNodes[0]);
				} else {
					head.appendChild(elem);
				}
			};
		}, {}], 2: [function (_dereq_, module, exports) {
			// Load modules

			var Stringify = _dereq_('./stringify');
			var Parse = _dereq_('./parse');

			// Declare internals

			var internals = {};

			module.exports = {
				stringify: Stringify,
				parse: Parse
			};
		}, { "./parse": 3, "./stringify": 4 }], 3: [function (_dereq_, module, exports) {
			// Load modules

			var Utils = _dereq_('./utils');

			// Declare internals

			var internals = {
				delimiter: '&',
				depth: 5,
				arrayLimit: 20,
				parameterLimit: 1000,
				strictNullHandling: false,
				plainObjects: false,
				allowPrototypes: false
			};

			internals.parseValues = function (str, options) {

				var obj = {};
				var parts = str.split(options.delimiter, options.parameterLimit === Infinity ? undefined : options.parameterLimit);

				for (var i = 0, il = parts.length; i < il; ++i) {
					var part = parts[i];
					var pos = part.indexOf(']=') === -1 ? part.indexOf('=') : part.indexOf(']=') + 1;

					if (pos === -1) {
						obj[Utils.decode(part)] = '';

						if (options.strictNullHandling) {
							obj[Utils.decode(part)] = null;
						}
					} else {
						var key = Utils.decode(part.slice(0, pos));
						var val = Utils.decode(part.slice(pos + 1));

						if (!Object.prototype.hasOwnProperty.call(obj, key)) {
							obj[key] = val;
						} else {
							obj[key] = [].concat(obj[key]).concat(val);
						}
					}
				}

				return obj;
			};

			internals.parseObject = function (chain, val, options) {

				if (!chain.length) {
					return val;
				}

				var root = chain.shift();

				var obj;
				if (root === '[]') {
					obj = [];
					obj = obj.concat(internals.parseObject(chain, val, options));
				} else {
					obj = options.plainObjects ? Object.create(null) : {};
					var cleanRoot = root[0] === '[' && root[root.length - 1] === ']' ? root.slice(1, root.length - 1) : root;
					var index = parseInt(cleanRoot, 10);
					var indexString = '' + index;
					if (!isNaN(index) && root !== cleanRoot && indexString === cleanRoot && index >= 0 && (options.parseArrays && index <= options.arrayLimit)) {

						obj = [];
						obj[index] = internals.parseObject(chain, val, options);
					} else {
						obj[cleanRoot] = internals.parseObject(chain, val, options);
					}
				}

				return obj;
			};

			internals.parseKeys = function (key, val, options) {

				if (!key) {
					return;
				}

				// Transform dot notation to bracket notation

				if (options.allowDots) {
					key = key.replace(/\.([^\.\[]+)/g, '[$1]');
				}

				// The regex chunks

				var parent = /^([^\[\]]*)/;
				var child = /(\[[^\[\]]*\])/g;

				// Get the parent

				var segment = parent.exec(key);

				// Stash the parent if it exists

				var keys = [];
				if (segment[1]) {
					// If we aren't using plain objects, optionally prefix keys
					// that would overwrite object prototype properties
					if (!options.plainObjects && Object.prototype.hasOwnProperty(segment[1])) {

						if (!options.allowPrototypes) {
							return;
						}
					}

					keys.push(segment[1]);
				}

				// Loop through children appending to the array until we hit depth

				var i = 0;
				while ((segment = child.exec(key)) !== null && i < options.depth) {

					++i;
					if (!options.plainObjects && Object.prototype.hasOwnProperty(segment[1].replace(/\[|\]/g, ''))) {

						if (!options.allowPrototypes) {
							continue;
						}
					}
					keys.push(segment[1]);
				}

				// If there's a remainder, just add whatever is left

				if (segment) {
					keys.push('[' + key.slice(segment.index) + ']');
				}

				return internals.parseObject(keys, val, options);
			};

			module.exports = function (str, options) {

				options = options || {};
				options.delimiter = typeof options.delimiter === 'string' || Utils.isRegExp(options.delimiter) ? options.delimiter : internals.delimiter;
				options.depth = typeof options.depth === 'number' ? options.depth : internals.depth;
				options.arrayLimit = typeof options.arrayLimit === 'number' ? options.arrayLimit : internals.arrayLimit;
				options.parseArrays = options.parseArrays !== false;
				options.allowDots = options.allowDots !== false;
				options.plainObjects = typeof options.plainObjects === 'boolean' ? options.plainObjects : internals.plainObjects;
				options.allowPrototypes = typeof options.allowPrototypes === 'boolean' ? options.allowPrototypes : internals.allowPrototypes;
				options.parameterLimit = typeof options.parameterLimit === 'number' ? options.parameterLimit : internals.parameterLimit;
				options.strictNullHandling = typeof options.strictNullHandling === 'boolean' ? options.strictNullHandling : internals.strictNullHandling;

				if (str === '' || str === null || typeof str === 'undefined') {

					return options.plainObjects ? Object.create(null) : {};
				}

				var tempObj = typeof str === 'string' ? internals.parseValues(str, options) : str;
				var obj = options.plainObjects ? Object.create(null) : {};

				// Iterate over the keys and setup the new object

				var keys = Object.keys(tempObj);
				for (var i = 0, il = keys.length; i < il; ++i) {
					var key = keys[i];
					var newObj = internals.parseKeys(key, tempObj[key], options);
					obj = Utils.merge(obj, newObj, options);
				}

				return Utils.compact(obj);
			};
		}, { "./utils": 5 }], 4: [function (_dereq_, module, exports) {
			// Load modules

			var Utils = _dereq_('./utils');

			// Declare internals

			var internals = {
				delimiter: '&',
				arrayPrefixGenerators: {
					brackets: function brackets(prefix, key) {

						return prefix + '[]';
					},
					indices: function indices(prefix, key) {

						return prefix + '[' + key + ']';
					},
					repeat: function repeat(prefix, key) {

						return prefix;
					}
				},
				strictNullHandling: false
			};

			internals.stringify = function (obj, prefix, generateArrayPrefix, strictNullHandling, filter) {

				if (typeof filter === 'function') {
					obj = filter(prefix, obj);
				} else if (Utils.isBuffer(obj)) {
					obj = obj.toString();
				} else if (obj instanceof Date) {
					obj = obj.toISOString();
				} else if (obj === null) {
					if (strictNullHandling) {
						return Utils.encode(prefix);
					}

					obj = '';
				}

				if (typeof obj === 'string' || typeof obj === 'number' || typeof obj === 'boolean') {

					return [Utils.encode(prefix) + '=' + Utils.encode(obj)];
				}

				var values = [];

				if (typeof obj === 'undefined') {
					return values;
				}

				var objKeys = Array.isArray(filter) ? filter : Object.keys(obj);
				for (var i = 0, il = objKeys.length; i < il; ++i) {
					var key = objKeys[i];

					if (Array.isArray(obj)) {
						values = values.concat(internals.stringify(obj[key], generateArrayPrefix(prefix, key), generateArrayPrefix, strictNullHandling, filter));
					} else {
						values = values.concat(internals.stringify(obj[key], prefix + '[' + key + ']', generateArrayPrefix, strictNullHandling, filter));
					}
				}

				return values;
			};

			module.exports = function (obj, options) {

				options = options || {};
				var delimiter = typeof options.delimiter === 'undefined' ? internals.delimiter : options.delimiter;
				var strictNullHandling = typeof options.strictNullHandling === 'boolean' ? options.strictNullHandling : internals.strictNullHandling;
				var objKeys;
				var filter;
				if (typeof options.filter === 'function') {
					filter = options.filter;
					obj = filter('', obj);
				} else if (Array.isArray(options.filter)) {
					objKeys = filter = options.filter;
				}

				var keys = [];

				if (typeof obj !== 'object' || obj === null) {

					return '';
				}

				var arrayFormat;
				if (options.arrayFormat in internals.arrayPrefixGenerators) {
					arrayFormat = options.arrayFormat;
				} else if ('indices' in options) {
					arrayFormat = options.indices ? 'indices' : 'repeat';
				} else {
					arrayFormat = 'indices';
				}

				var generateArrayPrefix = internals.arrayPrefixGenerators[arrayFormat];

				if (!objKeys) {
					objKeys = Object.keys(obj);
				}
				for (var i = 0, il = objKeys.length; i < il; ++i) {
					var key = objKeys[i];
					keys = keys.concat(internals.stringify(obj[key], key, generateArrayPrefix, strictNullHandling, filter));
				}

				return keys.join(delimiter);
			};
		}, { "./utils": 5 }], 5: [function (_dereq_, module, exports) {
			// Load modules

			// Declare internals

			var internals = {};
			internals.hexTable = new Array(256);
			for (var h = 0; h < 256; ++h) {
				internals.hexTable[h] = '%' + ((h < 16 ? '0' : '') + h.toString(16)).toUpperCase();
			}

			exports.arrayToObject = function (source, options) {

				var obj = options.plainObjects ? Object.create(null) : {};
				for (var i = 0, il = source.length; i < il; ++i) {
					if (typeof source[i] !== 'undefined') {

						obj[i] = source[i];
					}
				}

				return obj;
			};

			exports.merge = function (target, source, options) {

				if (!source) {
					return target;
				}

				if (typeof source !== 'object') {
					if (Array.isArray(target)) {
						target.push(source);
					} else if (typeof target === 'object') {
						target[source] = true;
					} else {
						target = [target, source];
					}

					return target;
				}

				if (typeof target !== 'object') {
					target = [target].concat(source);
					return target;
				}

				if (Array.isArray(target) && !Array.isArray(source)) {

					target = exports.arrayToObject(target, options);
				}

				var keys = Object.keys(source);
				for (var k = 0, kl = keys.length; k < kl; ++k) {
					var key = keys[k];
					var value = source[key];

					if (!Object.prototype.hasOwnProperty.call(target, key)) {
						target[key] = value;
					} else {
						target[key] = exports.merge(target[key], value, options);
					}
				}

				return target;
			};

			exports.decode = function (str) {

				try {
					return decodeURIComponent(str.replace(/\+/g, ' '));
				} catch (e) {
					return str;
				}
			};

			exports.encode = function (str) {

				// This code was originally written by Brian White (mscdex) for the io.js core querystring library.
				// It has been adapted here for stricter adherence to RFC 3986
				if (str.length === 0) {
					return str;
				}

				if (typeof str !== 'string') {
					str = '' + str;
				}

				var out = '';
				for (var i = 0, il = str.length; i < il; ++i) {
					var c = str.charCodeAt(i);

					if (c === 0x2D || // -
					c === 0x2E || // .
					c === 0x5F || // _
					c === 0x7E || // ~
					c >= 0x30 && c <= 0x39 || // 0-9
					c >= 0x41 && c <= 0x5A || // a-z
					c >= 0x61 && c <= 0x7A) {
						// A-Z

						out += str[i];
						continue;
					}

					if (c < 0x80) {
						out += internals.hexTable[c];
						continue;
					}

					if (c < 0x800) {
						out += internals.hexTable[0xC0 | c >> 6] + internals.hexTable[0x80 | c & 0x3F];
						continue;
					}

					if (c < 0xD800 || c >= 0xE000) {
						out += internals.hexTable[0xE0 | c >> 12] + internals.hexTable[0x80 | c >> 6 & 0x3F] + internals.hexTable[0x80 | c & 0x3F];
						continue;
					}

					++i;
					c = 0x10000 + ((c & 0x3FF) << 10 | str.charCodeAt(i) & 0x3FF);
					out += internals.hexTable[0xF0 | c >> 18] + internals.hexTable[0x80 | c >> 12 & 0x3F] + internals.hexTable[0x80 | c >> 6 & 0x3F] + internals.hexTable[0x80 | c & 0x3F];
				}

				return out;
			};

			exports.compact = function (obj, refs) {

				if (typeof obj !== 'object' || obj === null) {

					return obj;
				}

				refs = refs || [];
				var lookup = refs.indexOf(obj);
				if (lookup !== -1) {
					return refs[lookup];
				}

				refs.push(obj);

				if (Array.isArray(obj)) {
					var compacted = [];

					for (var i = 0, il = obj.length; i < il; ++i) {
						if (typeof obj[i] !== 'undefined') {
							compacted.push(obj[i]);
						}
					}

					return compacted;
				}

				var keys = Object.keys(obj);
				for (i = 0, il = keys.length; i < il; ++i) {
					var key = keys[i];
					obj[key] = exports.compact(obj[key], refs);
				}

				return obj;
			};

			exports.isRegExp = function (obj) {

				return Object.prototype.toString.call(obj) === '[object RegExp]';
			};

			exports.isBuffer = function (obj) {

				if (obj === null || typeof obj === 'undefined') {

					return false;
				}

				return !!(obj.constructor && obj.constructor.isBuffer && obj.constructor.isBuffer(obj));
			};
		}, {}], 6: [function (_dereq_, module, exports) {
			'use strict';

			exports.__esModule = true;
			exports['default'] = createStore;

			function _interopRequireDefault(obj) {
				return obj && obj.__esModule ? obj : { 'default': obj };
			}

			var _utilsIsPlainObject = _dereq_('./utils/isPlainObject');

			var _utilsIsPlainObject2 = _interopRequireDefault(_utilsIsPlainObject);

			/**
    * These are private action types reserved by Redux.
    * For any unknown actions, you must return the current state.
    * If the current state is undefined, you must return the initial state.
    * Do not reference these action types directly in your code.
    */
			var ActionTypes = {
				INIT: '@@redux/INIT'
			};

			exports.ActionTypes = ActionTypes;
			/**
    * Creates a Redux store that holds the state tree.
    * The only way to change the data in the store is to call `dispatch()` on it.
    *
    * There should only be a single store in your app. To specify how different
    * parts of the state tree respond to actions, you may combine several reducers
    * into a single reducer function by using `combineReducers`.
    *
    * @param {Function} reducer A function that returns the next state tree, given
    * the current state tree and the action to handle.
    *
    * @param {any} [initialState] The initial state. You may optionally specify it
    * to hydrate the state from the server in universal apps, or to restore a
    * previously serialized user session.
    * If you use `combineReducers` to produce the root reducer function, this must be
    * an object with the same shape as `combineReducers` keys.
    *
    * @returns {Store} A Redux store that lets you read the state, dispatch actions
    * and subscribe to changes.
    */

			function createStore(reducer, initialState) {
				if (typeof reducer !== 'function') {
					throw new Error('Expected the reducer to be a function.');
				}

				var currentReducer = reducer;
				var currentState = initialState;
				var listeners = [];
				var isDispatching = false;

				/**
     * Reads the state tree managed by the store.
     *
     * @returns {any} The current state tree of your application.
     */
				function getState() {
					return currentState;
				}

				/**
     * Adds a change listener. It will be called any time an action is dispatched,
     * and some part of the state tree may potentially have changed. You may then
     * call `getState()` to read the current state tree inside the callback.
     *
     * @param {Function} listener A callback to be invoked on every dispatch.
     * @returns {Function} A function to remove this change listener.
     */
				function subscribe(listener) {
					listeners.push(listener);

					return function unsubscribe() {
						var index = listeners.indexOf(listener);
						listeners.splice(index, 1);
					};
				}

				/**
     * Dispatches an action. It is the only way to trigger a state change.
     *
     * The `reducer` function, used to create the store, will be called with the
     * current state tree and the given `action`. Its return value will
     * be considered the **next** state of the tree, and the change listeners
     * will be notified.
     *
     * The base implementation only supports plain object actions. If you want to
     * dispatch a Promise, an Observable, a thunk, or something else, you need to
     * wrap your store creating function into the corresponding middleware. For
     * example, see the documentation for the `redux-thunk` package. Even the
     * middleware will eventually dispatch plain object actions using this method.
     *
     * @param {Object} action A plain object representing “what changed”. It is
     * a good idea to keep actions serializable so you can record and replay user
     * sessions, or use the time travelling `redux-devtools`.
     *
     * @returns {Object} For convenience, the same action object you dispatched.
     *
     * Note that, if you use a custom middleware, it may wrap `dispatch()` to
     * return something else (for example, a Promise you can await).
     */
				function dispatch(action) {
					if (!_utilsIsPlainObject2['default'](action)) {
						throw new Error('Actions must be plain objects. Use custom middleware for async actions.');
					}

					if (isDispatching) {
						throw new Error('Reducers may not dispatch actions.');
					}

					try {
						isDispatching = true;
						currentState = currentReducer(currentState, action);
					} finally {
						isDispatching = false;
					}

					listeners.slice().forEach(function (listener) {
						return listener();
					});
					return action;
				}

				/**
     * Returns the reducer currently used by the store to calculate the state.
     *
     * It is likely that you will only need this function if you implement a hot
     * reloading mechanism for Redux.
     *
     * @returns {Function} The reducer used by the current store.
     */
				function getReducer() {
					return currentReducer;
				}

				/**
     * Replaces the reducer currently used by the store to calculate the state.
     *
     * You might need this if your app implements code splitting and you want to
     * load some of the reducers dynamically. You might also need this if you
     * implement a hot reloading mechanism for Redux.
     *
     * @param {Function} nextReducer The reducer for the store to use instead.
     * @returns {void}
     */
				function replaceReducer(nextReducer) {
					currentReducer = nextReducer;
					dispatch({ type: ActionTypes.INIT });
				}

				// When a store is created, an "INIT" action is dispatched so that every
				// reducer returns their initial state. This effectively populates
				// the initial state tree.
				dispatch({ type: ActionTypes.INIT });

				return {
					dispatch: dispatch,
					subscribe: subscribe,
					getState: getState,
					getReducer: getReducer,
					replaceReducer: replaceReducer
				};
			}
		}, { "./utils/isPlainObject": 12 }], 7: [function (_dereq_, module, exports) {
			'use strict';

			exports.__esModule = true;

			function _interopRequireDefault(obj) {
				return obj && obj.__esModule ? obj : { 'default': obj };
			}

			var _createStore = _dereq_('./createStore');

			var _createStore2 = _interopRequireDefault(_createStore);

			var _utilsCombineReducers = _dereq_('./utils/combineReducers');

			var _utilsCombineReducers2 = _interopRequireDefault(_utilsCombineReducers);

			var _utilsBindActionCreators = _dereq_('./utils/bindActionCreators');

			var _utilsBindActionCreators2 = _interopRequireDefault(_utilsBindActionCreators);

			var _utilsApplyMiddleware = _dereq_('./utils/applyMiddleware');

			var _utilsApplyMiddleware2 = _interopRequireDefault(_utilsApplyMiddleware);

			var _utilsCompose = _dereq_('./utils/compose');

			var _utilsCompose2 = _interopRequireDefault(_utilsCompose);

			exports.createStore = _createStore2['default'];
			exports.combineReducers = _utilsCombineReducers2['default'];
			exports.bindActionCreators = _utilsBindActionCreators2['default'];
			exports.applyMiddleware = _utilsApplyMiddleware2['default'];
			exports.compose = _utilsCompose2['default'];
		}, { "./createStore": 6, "./utils/applyMiddleware": 8, "./utils/bindActionCreators": 9, "./utils/combineReducers": 10, "./utils/compose": 11 }], 8: [function (_dereq_, module, exports) {
			'use strict';

			exports.__esModule = true;

			var _extends = Object.assign || function (target) {
				for (var i = 1; i < arguments.length; i++) {
					var source = arguments[i];for (var key in source) {
						if (Object.prototype.hasOwnProperty.call(source, key)) {
							target[key] = source[key];
						}
					}
				}return target;
			};

			exports['default'] = applyMiddleware;

			function _interopRequireDefault(obj) {
				return obj && obj.__esModule ? obj : { 'default': obj };
			}

			var _compose = _dereq_('./compose');

			var _compose2 = _interopRequireDefault(_compose);

			/**
    * Creates a store enhancer that applies middleware to the dispatch method
    * of the Redux store. This is handy for a variety of tasks, such as expressing
    * asynchronous actions in a concise manner, or logging every action payload.
    *
    * See `redux-thunk` package as an example of the Redux middleware.
    *
    * Because middleware is potentially asynchronous, this should be the first
    * store enhancer in the composition chain.
    *
    * Note that each middleware will be given the `dispatch` and `getState` functions
    * as named arguments.
    *
    * @param {...Function} middlewares The middleware chain to be applied.
    * @returns {Function} A store enhancer applying the middleware.
    */

			function applyMiddleware() {
				for (var _len = arguments.length, middlewares = Array(_len), _key = 0; _key < _len; _key++) {
					middlewares[_key] = arguments[_key];
				}

				return function (next) {
					return function (reducer, initialState) {
						var store = next(reducer, initialState);
						var _dispatch = store.dispatch;
						var chain = [];

						var middlewareAPI = {
							getState: store.getState,
							dispatch: function dispatch(action) {
								return _dispatch(action);
							}
						};
						chain = middlewares.map(function (middleware) {
							return middleware(middlewareAPI);
						});
						_dispatch = _compose2['default'].apply(undefined, chain.concat([store.dispatch]));

						return _extends({}, store, {
							dispatch: _dispatch
						});
					};
				};
			}

			module.exports = exports['default'];
		}, { "./compose": 11 }], 9: [function (_dereq_, module, exports) {
			'use strict';

			exports.__esModule = true;
			exports['default'] = bindActionCreators;

			function _interopRequireDefault(obj) {
				return obj && obj.__esModule ? obj : { 'default': obj };
			}

			var _utilsMapValues = _dereq_('../utils/mapValues');

			var _utilsMapValues2 = _interopRequireDefault(_utilsMapValues);

			function bindActionCreator(actionCreator, dispatch) {
				return function () {
					return dispatch(actionCreator.apply(undefined, arguments));
				};
			}

			/**
    * Turns an object whose values are action creators, into an object with the
    * same keys, but with every function wrapped into a `dispatch` call so they
    * may be invoked directly. This is just a convenience method, as you can call
    * `store.dispatch(MyActionCreators.doSomething())` yourself just fine.
    *
    * For convenience, you can also pass a single function as the first argument,
    * and get a function in return.
    *
    * @param {Function|Object} actionCreators An object whose values are action
    * creator functions. One handy way to obtain it is to use ES6 `import * as`
    * syntax. You may also pass a single function.
    *
    * @param {Function} dispatch The `dispatch` function available on your Redux
    * store.
    *
    * @returns {Function|Object} The object mimicking the original object, but with
    * every action creator wrapped into the `dispatch` call. If you passed a
    * function as `actionCreators`, the return value will also be a single
    * function.
    */

			function bindActionCreators(actionCreators, dispatch) {
				if (typeof actionCreators === 'function') {
					return bindActionCreator(actionCreators, dispatch);
				}

				if (typeof actionCreators !== 'object' || actionCreators == null) {
					throw new Error('bindActionCreators expected an object or a function, instead received ' + typeof actionCreators + '. ' + 'Did you write "import ActionCreators from" instead of "import * as ActionCreators from"?');
				}

				return _utilsMapValues2['default'](actionCreators, function (actionCreator) {
					return bindActionCreator(actionCreator, dispatch);
				});
			}

			module.exports = exports['default'];
		}, { "../utils/mapValues": 13 }], 10: [function (_dereq_, module, exports) {
			'use strict';

			exports.__esModule = true;
			exports['default'] = combineReducers;

			function _interopRequireDefault(obj) {
				return obj && obj.__esModule ? obj : { 'default': obj };
			}

			var _createStore = _dereq_('../createStore');

			var _utilsIsPlainObject = _dereq_('../utils/isPlainObject');

			var _utilsIsPlainObject2 = _interopRequireDefault(_utilsIsPlainObject);

			var _utilsMapValues = _dereq_('../utils/mapValues');

			var _utilsMapValues2 = _interopRequireDefault(_utilsMapValues);

			var _utilsPick = _dereq_('../utils/pick');

			var _utilsPick2 = _interopRequireDefault(_utilsPick);

			function getErrorMessage(key, action) {
				var actionType = action && action.type;
				var actionName = actionType && '"' + actionType.toString() + '"' || 'an action';

				return 'Reducer "' + key + '" returned undefined handling ' + actionName + '. ' + 'To ignore an action, you must explicitly return the previous state.';
			}

			function verifyStateShape(initialState, currentState) {
				var reducerKeys = Object.keys(currentState);

				if (reducerKeys.length === 0) {
					console.error('Store does not have a valid reducer. Make sure the argument passed ' + 'to combineReducers is an object whose values are reducers.');
					return;
				}

				if (!_utilsIsPlainObject2['default'](initialState)) {
					console.error('initialState has unexpected type of "' + ({}).toString.call(initialState).match(/\s([a-z|A-Z]+)/)[1] + '". Expected initialState to be an object with the following ' + ('keys: "' + reducerKeys.join('", "') + '"'));
					return;
				}

				var unexpectedKeys = Object.keys(initialState).filter(function (key) {
					return reducerKeys.indexOf(key) < 0;
				});

				if (unexpectedKeys.length > 0) {
					console.error('Unexpected ' + (unexpectedKeys.length > 1 ? 'keys' : 'key') + ' ' + ('"' + unexpectedKeys.join('", "') + '" in initialState will be ignored. ') + ('Expected to find one of the known reducer keys instead: "' + reducerKeys.join('", "') + '"'));
				}
			}

			/**
    * Turns an object whose values are different reducer functions, into a single
    * reducer function. It will call every child reducer, and gather their results
    * into a single state object, whose keys correspond to the keys of the passed
    * reducer functions.
    *
    * @param {Object} reducers An object whose values correspond to different
    * reducer functions that need to be combined into one. One handy way to obtain
    * it is to use ES6 `import * as reducers` syntax. The reducers may never return
    * undefined for any action. Instead, they should return their initial state
    * if the state passed to them was undefined, and the current state for any
    * unrecognized action.
    *
    * @returns {Function} A reducer function that invokes every reducer inside the
    * passed object, and builds a state object with the same shape.
    */

			function combineReducers(reducers) {
				var finalReducers = _utilsPick2['default'](reducers, function (val) {
					return typeof val === 'function';
				});

				Object.keys(finalReducers).forEach(function (key) {
					var reducer = finalReducers[key];
					if (typeof reducer(undefined, { type: _createStore.ActionTypes.INIT }) === 'undefined') {
						throw new Error('Reducer "' + key + '" returned undefined during initialization. ' + 'If the state passed to the reducer is undefined, you must ' + 'explicitly return the initial state. The initial state may ' + 'not be undefined.');
					}

					var type = Math.random().toString(36).substring(7).split('').join('.');
					if (typeof reducer(undefined, { type: type }) === 'undefined') {
						throw new Error('Reducer "' + key + '" returned undefined when probed with a random type. ' + ('Don\'t try to handle ' + _createStore.ActionTypes.INIT + ' or other actions in "redux/*" ') + 'namespace. They are considered private. Instead, you must return the ' + 'current state for any unknown actions, unless it is undefined, ' + 'in which case you must return the initial state, regardless of the ' + 'action type. The initial state may not be undefined.');
					}
				});

				var defaultState = _utilsMapValues2['default'](finalReducers, function () {
					return undefined;
				});
				var stateShapeVerified;

				return function combination(state, action) {
					if (state === undefined) state = defaultState;

					var finalState = _utilsMapValues2['default'](finalReducers, function (reducer, key) {
						var newState = reducer(state[key], action);
						if (typeof newState === 'undefined') {
							throw new Error(getErrorMessage(key, action));
						}
						return newState;
					});

					if (
					// Node-like CommonJS environments (Browserify, Webpack)
					typeof process !== 'undefined' && typeof process.env !== 'undefined' && process.env.NODE_ENV !== 'production' ||
					// React Native
					typeof __DEV__ !== 'undefined' && __DEV__ //eslint-disable-line no-undef
					) {
							if (!stateShapeVerified) {
								verifyStateShape(state, finalState);
								stateShapeVerified = true;
							}
						}

					return finalState;
				};
			}

			module.exports = exports['default'];
		}, { "../createStore": 6, "../utils/isPlainObject": 12, "../utils/mapValues": 13, "../utils/pick": 14 }], 11: [function (_dereq_, module, exports) {
			/**
    * Composes functions from left to right.
    *
    * @param {...Function} funcs - The functions to compose. Each is expected to
    * accept a function as an argument and to return a function.
    * @returns {Function} A function obtained by composing functions from left to
    * right.
    */
			"use strict";

			exports.__esModule = true;
			exports["default"] = compose;

			function compose() {
				for (var _len = arguments.length, funcs = Array(_len), _key = 0; _key < _len; _key++) {
					funcs[_key] = arguments[_key];
				}

				return funcs.reduceRight(function (composed, f) {
					return f(composed);
				});
			}

			module.exports = exports["default"];
		}, {}], 12: [function (_dereq_, module, exports) {
			'use strict';

			exports.__esModule = true;
			exports['default'] = isPlainObject;
			var fnToString = function fnToString(fn) {
				return Function.prototype.toString.call(fn);
			};

			/**
    * @param {any} obj The object to inspect.
    * @returns {boolean} True if the argument appears to be a plain object.
    */

			function isPlainObject(obj) {
				if (!obj || typeof obj !== 'object') {
					return false;
				}

				var proto = typeof obj.constructor === 'function' ? Object.getPrototypeOf(obj) : Object.prototype;

				if (proto === null) {
					return true;
				}

				var constructor = proto.constructor;

				return typeof constructor === 'function' && constructor instanceof constructor && fnToString(constructor) === fnToString(Object);
			}

			module.exports = exports['default'];
		}, {}], 13: [function (_dereq_, module, exports) {
			/**
    * Applies a function to every key-value pair inside an object.
    *
    * @param {Object} obj The source object.
    * @param {Function} fn The mapper function taht receives the value and the key.
    * @returns {Object} A new object that contains the mapped values for the keys.
    */
			"use strict";

			exports.__esModule = true;
			exports["default"] = mapValues;

			function mapValues(obj, fn) {
				return Object.keys(obj).reduce(function (result, key) {
					result[key] = fn(obj[key], key);
					return result;
				}, {});
			}

			module.exports = exports["default"];
		}, {}], 14: [function (_dereq_, module, exports) {
			/**
    * Picks key-value pairs from an object where values satisfy a predicate.
    *
    * @param {Object} obj The object to pick from.
    * @param {Function} fn The predicate the values must satisfy to be copied.
    * @returns {Object} The object with the values that satisfied the predicate.
    */
			"use strict";

			exports.__esModule = true;
			exports["default"] = pick;

			function pick(obj, fn) {
				return Object.keys(obj).reduce(function (result, key) {
					if (fn(obj[key])) {
						result[key] = obj[key];
					}
					return result;
				}, {});
			}

			module.exports = exports["default"];
		}, {}], 15: [function (_dereq_, module, exports) {
			"use strict";

			Object.defineProperty(exports, "__esModule", {
				value: true
			});
			exports.setRealViewPort = setRealViewPort;
			exports.sendMouseWheel = sendMouseWheel;
			exports.setFill = setFill;

			function setRealViewPort(realViewPort) {
				return {
					type: "SET_REAL_VIEWPORT",
					realViewPort: realViewPort
				};
			}

			function sendMouseWheel(wheelState) {
				return {
					type: "SEND_MOUSEWHEEL",
					mousewheel: wheelState
				};
			}

			function setFill(mode) {
				return {
					type: "SET_FILL",
					mode: mode
				};
			}
		}, {}], 16: [function (_dereq_, module, exports) {
			"use strict";

			Object.defineProperty(exports, "__esModule", {
				value: true
			});

			var _createClass = (function () {
				function defineProperties(target, props) {
					for (var i = 0; i < props.length; i++) {
						var descriptor = props[i];descriptor.enumerable = descriptor.enumerable || false;descriptor.configurable = true;if ("value" in descriptor) descriptor.writable = true;Object.defineProperty(target, descriptor.key, descriptor);
					}
				}return function (Constructor, protoProps, staticProps) {
					if (protoProps) defineProperties(Constructor.prototype, protoProps);if (staticProps) defineProperties(Constructor, staticProps);return Constructor;
				};
			})();

			function _interopRequireDefault(obj) {
				return obj && obj.__esModule ? obj : { "default": obj };
			}

			function _classCallCheck(instance, Constructor) {
				if (!(instance instanceof Constructor)) {
					throw new TypeError("Cannot call a class as a function");
				}
			}

			var _qs = _dereq_("qs");

			var _qs2 = _interopRequireDefault(_qs);

			var IDX_WIDTH = 1;
			var IDX_HEIGHT = 0;
			var TILE_SIZE = 512;

			var Api = (function () {
				function Api(service, config) {
					_classCallCheck(this, Api);

					this.service = service;
					this.config = config;
					this.params = {
						rft_id: this.config.identifier,
						url_ver: "Z39.88-2004",
						svc_val_fmt: "info:ofi/fmt:kev:mtx:jpeg2000",
						"svc.format": "image/jpeg"
					};
					this.levels = parseInt(this.config.dwtLevels);
					this.fullWidth = parseInt(this.config.width);
					this.fullHeight = parseInt(this.config.height);
					this.resolutions = [];
					this.initializeResolutions(this.levels - 1, this.fullWidth, this.fullHeight);
					this.tileMap = {};
				}

				_createClass(Api, [{
					key: "initializeResolutions",
					value: function initializeResolutions(level, w, h) {
						this.resolutions.unshift([h, w]);
						if (level > 0) {
							this.initializeResolutions(--level, parseInt(Math.floor(w / 2)), parseInt(Math.floor(h / 2)));
						}
					}
				}, {
					key: "findLevel",
					value: function findLevel(dim, idx) {
						var i = undefined;
						for (i = 0; i < this.resolutions.length; i++) {
							if (this.resolutions[i][idx] > dim) {
								return i + 1;
							}
						}
						return i;
					}
				}, {
					key: "makeTileUrl",
					value: function makeTileUrl(level, dims) {

						return this.service + "?" + _qs2["default"].stringify(_extends2(this.params, {
							"svc.region": dims.join(","),
							"svc.level": level,
							"svc_id": "info:lanl-repo/svc/getRegion"
						}));
					}
				}, {
					key: "downScale",
					value: function downScale(val, times) {
						return times > 0 ? this.downScale(val / 2, --times) : val;
					}
				}, {
					key: "upScale",
					value: function upScale(val, times) {
						return times > 0 ? this.upScale(val * 2, --times) : val;
					}
				}, {
					key: "onTileLoad",
					value: function onTileLoad(tileIm, tile, onTile) {
						if (!tileIm.complete) {
							setTimeout(this.onTileLoad.bind(this, tileIm, tile, onTile), 15);
						} else {
							onTile(tileIm, tile);
						}
					}
				}, {
					key: "fetchTile",
					value: function fetchTile(tile, onTile) {
						var key = tile.realX + "-" + tile.realY + "-" + tile.level + "-" + tile.url;
						if (!this.tileMap[key]) {
							this.tileMap[key] = new Image();
							this.tileMap[key].onload = this.onTileLoad.bind(this, this.tileMap[key], tile, onTile);
							this.tileMap[key].src = tile.url;
						}
						onTile(this.tileMap[key], tile);
					}
				}, {
					key: "getStart",
					value: function getStart(dim) {
						var n = 0;
						while (dim + n < -TILE_SIZE) {
							n += TILE_SIZE;
						}
						return n;
					}
				}, {
					key: "makeTiles",
					value: function makeTiles(opts, level, scale, onTile) {
						var upscaleFactor = this.resolutions.length - level;
						var yStart = this.getStart(opts.position.y);
						var xStart = this.getStart(opts.position.x);

						for (var y = yStart; (y - yStart) * scale - TILE_SIZE * 2 + opts.position.y < opts.viewport.h && this.upScale(y, upscaleFactor) < this.fullHeight; y += TILE_SIZE) {

							for (var x = xStart; (x - xStart) * scale - TILE_SIZE * 2 + opts.position.x < opts.viewport.w && this.upScale(x, upscaleFactor) < this.fullWidth; x += TILE_SIZE) {

								var realTileW = this.upScale(x, upscaleFactor) + this.upScale(TILE_SIZE, upscaleFactor) > this.fullWidth ? parseInt(this.downScale(this.fullWidth - this.upScale(x, upscaleFactor), upscaleFactor)) : TILE_SIZE;

								var realTileH = this.upScale(y, upscaleFactor) + this.upScale(TILE_SIZE, upscaleFactor) > this.fullHeight ? parseInt(this.downScale(this.fullHeight - this.upScale(y, upscaleFactor), upscaleFactor)) : TILE_SIZE;

								this.fetchTile({
									realX: x,
									realY: y,
									timeStamp: opts.timeStamp,
									pos: {
										x: x,
										y: y
									},
									level: level,
									url: this.makeTileUrl(level, [this.upScale(y, upscaleFactor), this.upScale(x, upscaleFactor), TILE_SIZE, TILE_SIZE])
								}, opts.onTile, opts.onTileInit);
							}
						}
					}
				}, {
					key: "findLevelForScale",
					value: function findLevelForScale(s, level) {
						var current = arguments.length <= 2 || arguments[2] === undefined ? 1 : arguments[2];

						if (s > current / 2 || level === 1) {
							return level;
						}
						return this.findLevelForScale(s, --level, current / 2);
					}
				}, {
					key: "zoomTo",
					value: function zoomTo(zoom, scale, level, onScale) {
						var newLevel = this.findLevelForScale(zoom, this.levels);
						var newScale = this.upScale(zoom, this.resolutions.length - newLevel);
						onScale(newScale, newLevel, parseInt(Math.ceil(this.fullWidth * zoom)), parseInt(Math.ceil(this.fullHeight * zoom)));
					}
				}, {
					key: "zoomBy",
					value: function zoomBy(factor, scale, level, onScale) {
						var viewportScale = this.getRealScale(scale, level) + factor;
						if (viewportScale < 0.01) {
							viewportScale = 0.01;
						}
						var newLevel = this.findLevelForScale(viewportScale, this.levels);
						var newScale = this.upScale(viewportScale, this.resolutions.length - newLevel);

						onScale(newScale, newLevel, parseInt(Math.ceil(this.fullWidth * viewportScale)), parseInt(Math.ceil(this.fullHeight * viewportScale)));
					}
				}, {
					key: "getRealScale",
					value: function getRealScale(scale, level) {
						return this.downScale(scale, this.resolutions.length - level);
					}
				}, {
					key: "getRealImagePos",
					value: function getRealImagePos(position, scale, level) {
						var upscaleFactor = this.resolutions.length - level;
						return {
							x: Math.floor(this.upScale(position.x, upscaleFactor) * this.getRealScale(scale, level)),
							y: Math.floor(this.upScale(position.y, upscaleFactor) * this.getRealScale(scale, level)),
							w: Math.ceil(this.fullWidth * this.getRealScale(scale, level)),
							h: Math.ceil(this.fullHeight * this.getRealScale(scale, level))
						};
					}
				}, {
					key: "widthFill",
					value: function widthFill(opts) {
						var level = this.findLevel(opts.viewport.w, IDX_WIDTH);
						var scale = opts.viewport.w / this.resolutions[level - 1][IDX_WIDTH];
						var upscaleFactor = this.resolutions.length - level;
						var viewportScale = this.downScale(scale, upscaleFactor);

						if (opts.onScale) {
							opts.onScale(scale, level, parseInt(Math.ceil(this.fullWidth * viewportScale)), parseInt(Math.ceil(this.fullHeight * viewportScale)));
						}
						this.makeTiles(opts, level, scale);
					}
				}, {
					key: "fullZoom",
					value: function fullZoom(opts) {
						var level = this.levels;
						var scale = 1;

						if (opts.onScale) {
							opts.onScale(scale, level, parseInt(Math.ceil(this.fullWidth)), parseInt(Math.ceil(this.fullHeight)));
						}
						this.makeTiles(opts, level, scale);
					}
				}, {
					key: "heightFill",
					value: function heightFill(opts) {
						var level = this.findLevel(opts.viewport.h, IDX_HEIGHT);
						var scale = opts.viewport.h / this.resolutions[level - 1][IDX_HEIGHT];
						var upscaleFactor = this.resolutions.length - level;
						var viewportScale = this.downScale(scale, upscaleFactor);

						if (opts.onScale) {
							opts.onScale(scale, level, parseInt(Math.ceil(this.fullWidth * viewportScale)), parseInt(Math.ceil(this.fullHeight * viewportScale)));
						}

						this.makeTiles(opts, level, scale);
					}
				}, {
					key: "autoFill",
					value: function autoFill(opts) {
						if (opts.viewport.h < opts.viewport.w) {
							this.heightFill(opts);
						} else {
							this.widthFill(opts);
						}
					}
				}, {
					key: "loadImage",
					value: function loadImage(opts, onScale) {
						if (opts.scaleMode) {
							this[opts.scaleMode](opts);
						} else {
							this.makeTiles(opts, opts.level, opts.scale);
						}
					}
				}]);

				return Api;
			})();

			exports["default"] = Api;
			module.exports = exports["default"];
		}, { "qs": 2 }], 17: [function (_dereq_, module, exports) {
			"use strict";

			Object.defineProperty(exports, "__esModule", {
				value: true
			});

			var _extends = Object.assign || function (target) {
				for (var i = 1; i < arguments.length; i++) {
					var source = arguments[i];for (var key in source) {
						if (Object.prototype.hasOwnProperty.call(source, key)) {
							target[key] = source[key];
						}
					}
				}return target;
			};

			var initialState = {
				realViewPort: {
					x: 0, y: 0, w: 0, h: 0, zoom: 0, reposition: false
				},
				mousewheel: null,
				fillMode: null
			};

			exports["default"] = function (state, action) {
				if (state === undefined) state = initialState;

				switch (action.type) {
					case "SET_REAL_VIEWPORT":
						return _extends({}, state, { realViewPort: _extends({}, state.realViewPort, action.realViewPort) });
					case "SEND_MOUSEWHEEL":
						return _extends({}, state, { mousewheel: action.mousewheel });
					case "SET_FILL":
						return _extends({}, state, { fillMode: action.mode });
					default:
						return state;
				}
			};

			module.exports = exports["default"];
		}, {}], 18: [function (_dereq_, module, exports) {
			"use strict";

			Object.defineProperty(exports, "__esModule", {
				value: true
			});

			function _interopRequireDefault(obj) {
				return obj && obj.__esModule ? obj : { "default": obj };
			}

			var _redux = _dereq_("redux");

			var _reducers = _dereq_("./reducers");

			var _reducers2 = _interopRequireDefault(_reducers);

			var store = (0, _redux.createStore)(_reducers2["default"]);

			exports["default"] = store;
			module.exports = exports["default"];
		}, { "./reducers": 17, "redux": 7 }], 19: [function (_dereq_, module, exports) {
			"use strict";

			Object.defineProperty(exports, "__esModule", {
				value: true
			});

			var _extends = Object.assign || function (target) {
				for (var i = 1; i < arguments.length; i++) {
					var source = arguments[i];for (var key in source) {
						if (Object.prototype.hasOwnProperty.call(source, key)) {
							target[key] = source[key];
						}
					}
				}return target;
			};

			var _createClass = (function () {
				function defineProperties(target, props) {
					for (var i = 0; i < props.length; i++) {
						var descriptor = props[i];descriptor.enumerable = descriptor.enumerable || false;descriptor.configurable = true;if ("value" in descriptor) descriptor.writable = true;Object.defineProperty(target, descriptor.key, descriptor);
					}
				}return function (Constructor, protoProps, staticProps) {
					if (protoProps) defineProperties(Constructor.prototype, protoProps);if (staticProps) defineProperties(Constructor, staticProps);return Constructor;
				};
			})();

			var _get = function get(_x2, _x3, _x4) {
				var _again = true;_function: while (_again) {
					var object = _x2,
					    property = _x3,
					    receiver = _x4;desc = parent = getter = undefined;_again = false;if (object === null) object = Function.prototype;var desc = Object.getOwnPropertyDescriptor(object, property);if (desc === undefined) {
						var parent = Object.getPrototypeOf(object);if (parent === null) {
							return undefined;
						} else {
							_x2 = parent;_x3 = property;_x4 = receiver;_again = true;continue _function;
						}
					} else if ("value" in desc) {
						return desc.value;
					} else {
						var getter = desc.get;if (getter === undefined) {
							return undefined;
						}return getter.call(receiver);
					}
				}
			};

			function _interopRequireDefault(obj) {
				return obj && obj.__esModule ? obj : { "default": obj };
			}

			function _toConsumableArray(arr) {
				if (Array.isArray(arr)) {
					for (var i = 0, arr2 = Array(arr.length); i < arr.length; i++) arr2[i] = arr[i];return arr2;
				} else {
					return Array.from(arr);
				}
			}

			function _classCallCheck(instance, Constructor) {
				if (!(instance instanceof Constructor)) {
					throw new TypeError("Cannot call a class as a function");
				}
			}

			function _inherits(subClass, superClass) {
				if (typeof superClass !== "function" && superClass !== null) {
					throw new TypeError("Super expression must either be null or a function, not " + typeof superClass);
				}subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } });if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass;
			}

			var _react = _dereq_("react");

			var _react2 = _interopRequireDefault(_react);

			var _apiApi = _dereq_("../api/api");

			var _apiApi2 = _interopRequireDefault(_apiApi);

			var _apiActions = _dereq_("../api/actions");

			var _apiStore = _dereq_("../api/store");

			var _apiStore2 = _interopRequireDefault(_apiStore);

			var _utilRequestAnimationFrame = _dereq_('../util/request-animation-frame');

			var MOUSE_UP = 0;
			var MOUSE_DOWN = 1;

			var TOUCH_END = 0;
			var TOUCH_START = 1;

			var RESIZE_DELAY = 5;

			var SUPPORTED_SCALE_MODES = ["heightFill", "widthFill", "autoFill", "fullZoom"];

			var DjakotaClient = (function (_React$Component) {
				_inherits(DjakotaClient, _React$Component);

				function DjakotaClient(props) {
					_classCallCheck(this, DjakotaClient);

					_get(Object.getPrototypeOf(DjakotaClient.prototype), "constructor", this).call(this, props);
					this.api = new _apiApi2["default"](this.props.service, this.props.config);

					this.state = {
						width: null,
						height: null
					};

					this.movement = { x: 0, y: 0 };
					this.touchPos = { x: 0, y: 0 };
					this.mousePos = { x: 0, y: 0 };
					this.imagePos = { x: 0, y: 0 };
					this.mouseState = MOUSE_UP;
					this.imageCtx = null;
					this.resizeDelay = 0;
					this.scale = 1.0;
					this.level = null;
					this.width = null;
					this.height = null;

					this.resizeListener = this.onResize.bind(this);
					this.animationFrameListener = this.onAnimationFrame.bind(this);
					this.mousemoveListener = this.onMouseMove.bind(this);
					this.mouseupListener = this.onMouseUp.bind(this);
					this.frameBuffer = [];
					this.repaintDelay = -1;
					this.touchmap = { startPos: false, positions: [], tapStart: 0, lastTap: 0, pinchDelta: 0, pinchDistance: 0 };
				}

				_createClass(DjakotaClient, [{
					key: "componentDidMount",
					value: function componentDidMount() {
						var _this = this;

						this.commitResize();
						this.imageCtx = _react2["default"].findDOMNode(this).children[0].getContext('2d');
						window.addEventListener("resize", this.resizeListener);
						window.addEventListener("mousemove", this.mousemoveListener);
						window.addEventListener("mouseup", this.mouseupListener);

						this.unsubscribe = _apiStore2["default"].subscribe(function () {
							return _this.setState(_apiStore2["default"].getState(), _this.receiveNewState.bind(_this));
						});
						(0, _utilRequestAnimationFrame.requestAnimationFrame)(this.animationFrameListener);
					}
				}, {
					key: "componentWillReceiveProps",
					value: function componentWillReceiveProps(nextProps) {
						if (nextProps.config.identifier !== this.props.config.identifier) {
							this.api = new _apiApi2["default"](this.props.service, nextProps.config);
							this.commitResize();
						}
					}
				}, {
					key: "shouldComponentUpdate",
					value: function shouldComponentUpdate(nextProps, nextState) {
						return this.state.width !== nextState.width || this.state.height !== nextState.height || this.props.config.identifier !== nextProps.config.identifier;
					}
				}, {
					key: "componentWillUnmount",
					value: function componentWillUnmount() {
						window.removeEventListener("resize", this.resizeListener);
						window.removeEventListener("mousemove", this.mousemoveListener);
						window.removeEventListener("mouseup", this.mouseupListener);
						this.unsubscribe();
						(0, _utilRequestAnimationFrame.cancelAnimationFrame)(this.animationFrameListener);
					}
				}, {
					key: "notifyRealImagePos",
					value: function notifyRealImagePos() {
						var zoom = this.api.getRealScale(this.scale, this.level);
						var dims = this.api.getRealImagePos(this.imagePos, this.scale, this.level);
						_apiStore2["default"].dispatch((0, _apiActions.setRealViewPort)({
							x: -dims.x / dims.w,
							y: -dims.y / dims.h,
							w: this.state.width / dims.w,
							h: this.state.height / dims.h,
							zoom: zoom,
							reposition: false,
							applyZoom: false
						}));
					}
				}, {
					key: "receiveNewState",
					value: function receiveNewState() {

						if (this.state.realViewPort.reposition) {
							var _api$getRealImagePos = this.api.getRealImagePos(this.imagePos, this.scale, this.level);

							var w = _api$getRealImagePos.w;
							var h = _api$getRealImagePos.h;

							this.imagePos.x = -(w * this.state.realViewPort.x / this.scale);
							this.imagePos.y = -(h * this.state.realViewPort.y / this.scale);
							this.loadImage({ scale: this.scale, level: this.level });
						}

						if (this.state.realViewPort.applyZoom) {
							this.api.zoomTo(this.state.realViewPort.zoom, this.scale, this.level, this.zoom.bind(this));
						}

						if (this.state.mousewheel) {
							_apiStore2["default"].dispatch((0, _apiActions.sendMouseWheel)(false));
							this.api.zoomBy(this.determineZoomFactor(this.state.mousewheel.deltaY), this.scale, this.level, this.zoom.bind(this));
						}

						if (this.state.fillMode) {
							_apiStore2["default"].dispatch((0, _apiActions.setFill)(false));
							this.imagePos.x = 0;
							this.imagePos.y = 0;
							this.loadImage({ scaleMode: this.state.fillMode });
						}
					}
				}, {
					key: "onAnimationFrame",
					value: function onAnimationFrame() {
						this.imageCtx.clearRect(0, 0, this.state.width, this.state.height);

						for (var i = 0; i < this.frameBuffer.length; i++) {
							var _imageCtx;

							(_imageCtx = this.imageCtx).drawImage.apply(_imageCtx, _toConsumableArray(this.frameBuffer[i]));
						}

						if (this.resizeDelay === 0 && this.resizing) {
							this.commitResize();
						} else if (this.resizeDelay > 0) {
							this.resizeDelay--;
						}
						(0, _utilRequestAnimationFrame.requestAnimationFrame)(this.animationFrameListener);
					}
				}, {
					key: "onResize",
					value: function onResize() {
						this.resizeDelay = RESIZE_DELAY;
						this.resizing = true;
					}
				}, {
					key: "commitResize",
					value: function commitResize() {
						this.resizeDelay = RESIZE_DELAY;
						this.resizing = false;
						this.imagePos.x = 0;
						this.imagePos.y = 0;
						this.width = null;
						this.height = null;
						var node = _react2["default"].findDOMNode(this);
						this.setState({
							width: node.clientWidth,
							height: node.clientHeight
						}, this.loadImage.bind(this));
					}
				}, {
					key: "loadImage",
					value: function loadImage() {
						var opts = arguments.length <= 0 || arguments[0] === undefined ? { scaleMode: this.props.scaleMode } : arguments[0];

						this.notifyRealImagePos();
						this.frameBuffer = [];
						this.api.loadImage(_extends({
							viewport: { w: this.state.width, h: this.state.height },
							position: this.imagePos,
							onTile: this.renderTile.bind(this),
							onScale: this.onDimensions.bind(this)
						}, opts));
					}
				}, {
					key: "setScale",
					value: function setScale(s, l) {
						this.scale = s;
						this.level = l;
					}
				}, {
					key: "setDimensions",
					value: function setDimensions(w, h) {
						this.width = w;
						this.height = h;
					}
				}, {
					key: "renderTile",
					value: function renderTile(tileIm, tile) {
						this.frameBuffer.push([tileIm, parseInt(Math.floor((tile.pos.x + this.imagePos.x) * this.scale)), parseInt(Math.floor((tile.pos.y + this.imagePos.y) * this.scale)), parseInt(Math.ceil(tileIm.width * this.scale)), parseInt(Math.ceil(tileIm.height * this.scale))]);
					}
				}, {
					key: "onMouseDown",
					value: function onMouseDown(ev) {
						this.mousePos.x = ev.clientX;
						this.mousePos.y = ev.clientY;
						this.movement = { x: 0, y: 0 };
						this.mouseState = MOUSE_DOWN;
					}
				}, {
					key: "onTouchStart",
					value: function onTouchStart(ev) {
						this.touchPos.x = ev.touches[0].pageX;
						this.touchPos.y = ev.touches[0].pageY;
						this.movement = { x: 0, y: 0 };
						this.touchState = TOUCH_START;
					}
				}, {
					key: "onMouseMove",
					value: function onMouseMove(ev) {
						switch (this.mouseState) {
							case MOUSE_DOWN:
								this.movement.x = this.mousePos.x - ev.clientX;
								this.movement.y = this.mousePos.y - ev.clientY;
								this.imagePos.x -= this.movement.x / this.scale;
								this.imagePos.y -= this.movement.y / this.scale;
								this.mousePos.x = ev.clientX;
								this.mousePos.y = ev.clientY;
								this.loadImage({ scale: this.scale, level: this.level });
								return ev.preventDefault();
							case MOUSE_UP:
							default:
						}
					}
				}, {
					key: "onTouchMove",
					value: function onTouchMove(ev) {
						for (var i = 0; i < ev.touches.length; i++) {
							var cur = { x: ev.touches[i].pageX, y: ev.touches[i].pageY };
							this.touchmap.positions[i] = cur;
						}
						// TODO use TOUCH_STATE PINCH and TOUCH_STATE TOUCH
						if (ev.touches.length === 2) {
							var oldD = this.touchmap.pinchDistance;
							this.touchmap.pinchDistance = parseInt(Math.sqrt((this.touchmap.positions[0].x - this.touchmap.positions[1].x) * (this.touchmap.positions[0].x - this.touchmap.positions[1].x) + (this.touchmap.positions[0].y - this.touchmap.positions[1].y) * (this.touchmap.positions[0].y - this.touchmap.positions[1].y)), 10);
							this.touchmap.pinchDelta = oldD - this.touchmap.pinchDistance;
							if (this.touchmap.pinchDelta < 50 && this.touchmap.pinchDelta > -50) {
								this.api.zoomBy(this.determineZoomFactor(this.touchmap.pinchDelta), this.scale, this.level, this.zoom.bind(this));
							}
						} else {
							this.movement.x = this.touchPos.x - ev.touches[0].pageX;
							this.movement.y = this.touchPos.y - ev.touches[0].pageY;
							this.imagePos.x -= this.movement.x / this.scale;
							this.imagePos.y -= this.movement.y / this.scale;
							this.touchPos.x = ev.touches[0].pageX;
							this.touchPos.y = ev.touches[0].pageY;
							this.loadImage({ scale: this.scale, level: this.level });
						}
						ev.preventDefault();
						ev.stopPropagation();
					}
				}, {
					key: "onTouchEnd",
					value: function onTouchEnd(ev) {
						this.touchState = TOUCH_END;
					}
				}, {
					key: "onMouseUp",
					value: function onMouseUp(ev) {
						if (this.mouseState === MOUSE_DOWN) {
							this.loadImage({ scale: this.scale, level: this.level });
						}
						this.mouseState = MOUSE_UP;
					}
				}, {
					key: "center",
					value: function center(w, h) {
						if (w > this.state.width) {
							this.imagePos.x = -parseInt((w - this.state.width) / 2) / this.scale;
						} else if (w < this.state.width) {
							this.imagePos.x = parseInt((this.state.width - w) / 2) / this.scale;
						}

						if (h > this.state.height) {
							this.imagePos.y = -parseInt((h - this.state.height) / 2) / this.scale;
						} else if (h < this.state.width) {
							this.imagePos.y = parseInt((this.state.height - h) / 2) / this.scale;
						}
					}
				}, {
					key: "onDimensions",
					value: function onDimensions(s, l, w, h) {
						this.setDimensions(w, h);
						this.setScale(s, l);
						this.center(w, h);
						this.notifyRealImagePos();
					}
				}, {
					key: "zoom",
					value: function zoom(s, l, w, h) {
						var origX = this.imagePos.x * this.scale;
						var origY = this.imagePos.y * this.scale;
						var origW = this.width;
						var origH = this.height;

						this.setDimensions(w, h);
						this.setScale(s, l);

						if (origW === null || origH === null) {
							this.center(w, h);
						} else {
							var diffX = Math.floor((origW - this.width) / 2);
							var diffY = Math.floor((origH - this.height) / 2);
							this.imagePos.x = (origX + diffX) / this.scale;
							this.imagePos.y = (origY + diffY) / this.scale;
						}
						this.loadImage({ scale: this.scale, level: this.level });
					}
				}, {
					key: "determineZoomFactor",
					value: function determineZoomFactor(delta) {
						var rev = delta > 0 ? -1 : 1;
						var rs = this.api.getRealScale(this.scale, this.level);
						if (rs >= 0.6) {
							return 0.04 * rev;
						} else if (rs >= 0.3) {
							return 0.02 * rev;
						} else {
							return 0.01 * rev;
						}
					}
				}, {
					key: "onWheel",
					value: function onWheel(ev) {
						this.api.zoomBy(this.determineZoomFactor(ev.nativeEvent.deltaY), this.scale, this.level, this.zoom.bind(this));

						return ev.preventDefault();
					}
				}, {
					key: "render",
					value: function render() {
						return _react2["default"].createElement("div", { className: "hire-djakota-client" }, _react2["default"].createElement("canvas", {
							className: "image",
							height: this.state.height,
							width: this.state.width
						}), _react2["default"].createElement("canvas", {
							className: "interaction",
							height: this.state.height,
							onMouseDown: this.onMouseDown.bind(this),
							onTouchEnd: this.onTouchEnd.bind(this),
							onTouchMove: this.onTouchMove.bind(this),
							onTouchStart: this.onTouchStart.bind(this),
							onWheel: this.onWheel.bind(this),
							width: this.state.width
						}));
					}
				}]);

				return DjakotaClient;
			})(_react2["default"].Component);

			DjakotaClient.propTypes = {
				config: _react2["default"].PropTypes.object.isRequired,
				scaleMode: function scaleMode(props, propName, componentName) {
					if (SUPPORTED_SCALE_MODES.indexOf(props[propName]) < 0) {
						var msg = "Scale mode '" + props[propName] + "' not supported. Modes: " + SUPPORTED_SCALE_MODES.join(", ");
						props[propName] = "heightFill";
						return new Error(msg);
					}
				},
				service: _react2["default"].PropTypes.string.isRequired
			};

			DjakotaClient.defaultProps = {
				scaleMode: "heightFill"
			};

			exports["default"] = DjakotaClient;
			module.exports = exports["default"];
		}, { "../api/actions": 15, "../api/api": 16, "../api/store": 18, "../util/request-animation-frame": 27, "react": "react" }], 20: [function (_dereq_, module, exports) {
			"use strict";

			Object.defineProperty(exports, "__esModule", {
				value: true
			});

			var _createClass = (function () {
				function defineProperties(target, props) {
					for (var i = 0; i < props.length; i++) {
						var descriptor = props[i];descriptor.enumerable = descriptor.enumerable || false;descriptor.configurable = true;if ("value" in descriptor) descriptor.writable = true;Object.defineProperty(target, descriptor.key, descriptor);
					}
				}return function (Constructor, protoProps, staticProps) {
					if (protoProps) defineProperties(Constructor.prototype, protoProps);if (staticProps) defineProperties(Constructor, staticProps);return Constructor;
				};
			})();

			var _get = function get(_x, _x2, _x3) {
				var _again = true;_function: while (_again) {
					var object = _x,
					    property = _x2,
					    receiver = _x3;desc = parent = getter = undefined;_again = false;if (object === null) object = Function.prototype;var desc = Object.getOwnPropertyDescriptor(object, property);if (desc === undefined) {
						var parent = Object.getPrototypeOf(object);if (parent === null) {
							return undefined;
						} else {
							_x = parent;_x2 = property;_x3 = receiver;_again = true;continue _function;
						}
					} else if ("value" in desc) {
						return desc.value;
					} else {
						var getter = desc.get;if (getter === undefined) {
							return undefined;
						}return getter.call(receiver);
					}
				}
			};

			function _interopRequireDefault(obj) {
				return obj && obj.__esModule ? obj : { "default": obj };
			}

			function _classCallCheck(instance, Constructor) {
				if (!(instance instanceof Constructor)) {
					throw new TypeError("Cannot call a class as a function");
				}
			}

			function _inherits(subClass, superClass) {
				if (typeof superClass !== "function" && superClass !== null) {
					throw new TypeError("Super expression must either be null or a function, not " + typeof superClass);
				}subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } });if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass;
			}

			var _react = _dereq_("react");

			var _react2 = _interopRequireDefault(_react);

			var _iconsHeightFill = _dereq_("./icons/height-fill");

			var _iconsHeightFill2 = _interopRequireDefault(_iconsHeightFill);

			var _iconsWidthFill = _dereq_("./icons/width-fill");

			var _iconsWidthFill2 = _interopRequireDefault(_iconsWidthFill);

			var _iconsAutoFill = _dereq_("./icons/auto-fill");

			var _iconsAutoFill2 = _interopRequireDefault(_iconsAutoFill);

			var _apiActions = _dereq_("../api/actions");

			var _apiStore = _dereq_("../api/store");

			var _apiStore2 = _interopRequireDefault(_apiStore);

			var MOUSE_UP = 0;
			var MOUSE_DOWN = 1;

			var SUPPORTED_SCALE_MODES = ["heightFill", "widthFill", "autoFill", "fullZoom"];

			var FillButton = (function (_React$Component) {
				_inherits(FillButton, _React$Component);

				function FillButton() {
					_classCallCheck(this, FillButton);

					_get(Object.getPrototypeOf(FillButton.prototype), "constructor", this).apply(this, arguments);
				}

				_createClass(FillButton, [{
					key: "renderIcon",
					value: function renderIcon() {
						switch (this.props.scaleMode) {
							case "fullZoom":
								return "100%";
							case "autoFill":
								return _react2["default"].createElement(_iconsAutoFill2["default"], null);
							case "heightFill":
								return _react2["default"].createElement(_iconsHeightFill2["default"], null);
							case "widthFill":
							default:
								return _react2["default"].createElement(_iconsWidthFill2["default"], null);
						}
					}
				}, {
					key: "onClick",
					value: function onClick() {
						_apiStore2["default"].dispatch((0, _apiActions.setFill)(this.props.scaleMode));
					}
				}, {
					key: "render",
					value: function render() {
						return _react2["default"].createElement("button", { className: "hire-fill-button", onClick: this.onClick.bind(this) }, this.renderIcon());
					}
				}]);

				return FillButton;
			})(_react2["default"].Component);

			FillButton.propTypes = {
				scaleMode: function scaleMode(props, propName, componentName) {
					if (SUPPORTED_SCALE_MODES.indexOf(props[propName]) < 0) {
						var msg = "Scale mode '" + props[propName] + "' not supported. Modes: " + SUPPORTED_SCALE_MODES.join(", ");
						props[propName] = "heightFill";
						return new Error(msg);
					}
				}
			};

			FillButton.defaultProps = {
				scaleMode: "heightFill"
			};

			exports["default"] = FillButton;

			/*
   <svg
     style="stroke:#000000;stroke-width:1px;stroke-opacity:1"
      viewBox="0 0 16 16">
       <g transform="rotate(90,8,8)">
           <path d="M 2.1,8.5 13.876786,8.5"/>
           <path d="M 14.2895,8.8224 10.876793,5.4933"/>
           <path d="M 1.5196504,8.7867 4.9323574,5.4576"/>
           <path d="M 14.27524,8.1261353 11.216057,11.258414" />
           <path d="M 1.5503841,8.1252136 4.3668137,11.302078" />
           <path d="m 15.386755,4.3822 0.01012,8.1302" />
           <path d="m 0.58963983,4.3191 0.010124,8.1302" />
     </g>
   </svg>
   */
			module.exports = exports["default"];
		}, { "../api/actions": 15, "../api/store": 18, "./icons/auto-fill": 21, "./icons/height-fill": 22, "./icons/width-fill": 23, "react": "react" }], 21: [function (_dereq_, module, exports) {
			"use strict";

			Object.defineProperty(exports, "__esModule", {
				value: true
			});

			var _createClass = (function () {
				function defineProperties(target, props) {
					for (var i = 0; i < props.length; i++) {
						var descriptor = props[i];descriptor.enumerable = descriptor.enumerable || false;descriptor.configurable = true;if ("value" in descriptor) descriptor.writable = true;Object.defineProperty(target, descriptor.key, descriptor);
					}
				}return function (Constructor, protoProps, staticProps) {
					if (protoProps) defineProperties(Constructor.prototype, protoProps);if (staticProps) defineProperties(Constructor, staticProps);return Constructor;
				};
			})();

			var _get = function get(_x, _x2, _x3) {
				var _again = true;_function: while (_again) {
					var object = _x,
					    property = _x2,
					    receiver = _x3;desc = parent = getter = undefined;_again = false;if (object === null) object = Function.prototype;var desc = Object.getOwnPropertyDescriptor(object, property);if (desc === undefined) {
						var parent = Object.getPrototypeOf(object);if (parent === null) {
							return undefined;
						} else {
							_x = parent;_x2 = property;_x3 = receiver;_again = true;continue _function;
						}
					} else if ("value" in desc) {
						return desc.value;
					} else {
						var getter = desc.get;if (getter === undefined) {
							return undefined;
						}return getter.call(receiver);
					}
				}
			};

			function _interopRequireDefault(obj) {
				return obj && obj.__esModule ? obj : { "default": obj };
			}

			function _classCallCheck(instance, Constructor) {
				if (!(instance instanceof Constructor)) {
					throw new TypeError("Cannot call a class as a function");
				}
			}

			function _inherits(subClass, superClass) {
				if (typeof superClass !== "function" && superClass !== null) {
					throw new TypeError("Super expression must either be null or a function, not " + typeof superClass);
				}subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } });if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass;
			}

			var _react = _dereq_("react");

			var _react2 = _interopRequireDefault(_react);

			var AutoFill = (function (_React$Component) {
				_inherits(AutoFill, _React$Component);

				function AutoFill() {
					_classCallCheck(this, AutoFill);

					_get(Object.getPrototypeOf(AutoFill.prototype), "constructor", this).apply(this, arguments);
				}

				_createClass(AutoFill, [{
					key: "render",
					value: function render() {
						return _react2["default"].createElement("svg", { viewBox: "0 -2 16 20" }, _react2["default"].createElement("path", { d: "M 2.2510028,2.3999952 14.134355,13.976932", style: { strokeWidth: 2 } }), _react2["default"].createElement("path", { d: "M 0.17726274,4.8389082 0.0558895,0.07290967 4.6198279,0.27222077", style: { strokeWidth: 0 } }), _react2["default"].createElement("path", {
							d: "m 15.925831,11.287935 0.121374,4.765999 -4.563938,-0.199312",

							style: { strokeWidth: 0 }
						}), _react2["default"].createElement("path", {
							d: "M 13.731112,2.2550713 2.1257829,14.110698",

							style: { strokeWidth: 2 } }), _react2["default"].createElement("path", {
							d: "M 11.297166,0.17550349 16.063441,0.06553063 15.853214,4.6289791",

							style: { strokeWidth: 0 }
						}), _react2["default"].createElement("path", {
							d: "M 4.8104871,15.908601 0.0442114,16.018574 0.2544395,11.455126",

							style: { strokeWidth: 0 }
						}));
					}
				}]);

				return AutoFill;
			})(_react2["default"].Component);

			exports["default"] = AutoFill;
			module.exports = exports["default"];
		}, { "react": "react" }], 22: [function (_dereq_, module, exports) {
			"use strict";

			Object.defineProperty(exports, "__esModule", {
				value: true
			});

			var _createClass = (function () {
				function defineProperties(target, props) {
					for (var i = 0; i < props.length; i++) {
						var descriptor = props[i];descriptor.enumerable = descriptor.enumerable || false;descriptor.configurable = true;if ("value" in descriptor) descriptor.writable = true;Object.defineProperty(target, descriptor.key, descriptor);
					}
				}return function (Constructor, protoProps, staticProps) {
					if (protoProps) defineProperties(Constructor.prototype, protoProps);if (staticProps) defineProperties(Constructor, staticProps);return Constructor;
				};
			})();

			var _get = function get(_x, _x2, _x3) {
				var _again = true;_function: while (_again) {
					var object = _x,
					    property = _x2,
					    receiver = _x3;desc = parent = getter = undefined;_again = false;if (object === null) object = Function.prototype;var desc = Object.getOwnPropertyDescriptor(object, property);if (desc === undefined) {
						var parent = Object.getPrototypeOf(object);if (parent === null) {
							return undefined;
						} else {
							_x = parent;_x2 = property;_x3 = receiver;_again = true;continue _function;
						}
					} else if ("value" in desc) {
						return desc.value;
					} else {
						var getter = desc.get;if (getter === undefined) {
							return undefined;
						}return getter.call(receiver);
					}
				}
			};

			function _interopRequireDefault(obj) {
				return obj && obj.__esModule ? obj : { "default": obj };
			}

			function _classCallCheck(instance, Constructor) {
				if (!(instance instanceof Constructor)) {
					throw new TypeError("Cannot call a class as a function");
				}
			}

			function _inherits(subClass, superClass) {
				if (typeof superClass !== "function" && superClass !== null) {
					throw new TypeError("Super expression must either be null or a function, not " + typeof superClass);
				}subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } });if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass;
			}

			var _react = _dereq_("react");

			var _react2 = _interopRequireDefault(_react);

			var HeightFill = (function (_React$Component) {
				_inherits(HeightFill, _React$Component);

				function HeightFill() {
					_classCallCheck(this, HeightFill);

					_get(Object.getPrototypeOf(HeightFill.prototype), "constructor", this).apply(this, arguments);
				}

				_createClass(HeightFill, [{
					key: "render",
					value: function render() {
						return _react2["default"].createElement("svg", { viewBox: "0 0 18 17" }, _react2["default"].createElement("g", null, _react2["default"].createElement("path", { d: "m 7.8735657,3.2305929 0.088125,9.1793421", style: { strokeWidth: 2 } }), _react2["default"].createElement("path", { d: "M 4.6336281,3.641452 7.9449077,0.21145225 11.004625,3.6037073", style: { strokeWidth: 0 } }), _react2["default"].createElement("path", { d: "m 11.229771,12.149816 -3.3112819,3.43 -3.0597154,-3.392255", style: { strokeWidth: 0 } })));
					}
				}]);

				return HeightFill;
			})(_react2["default"].Component);

			exports["default"] = HeightFill;
			module.exports = exports["default"];
		}, { "react": "react" }], 23: [function (_dereq_, module, exports) {
			"use strict";

			Object.defineProperty(exports, "__esModule", {
				value: true
			});

			var _createClass = (function () {
				function defineProperties(target, props) {
					for (var i = 0; i < props.length; i++) {
						var descriptor = props[i];descriptor.enumerable = descriptor.enumerable || false;descriptor.configurable = true;if ("value" in descriptor) descriptor.writable = true;Object.defineProperty(target, descriptor.key, descriptor);
					}
				}return function (Constructor, protoProps, staticProps) {
					if (protoProps) defineProperties(Constructor.prototype, protoProps);if (staticProps) defineProperties(Constructor, staticProps);return Constructor;
				};
			})();

			var _get = function get(_x, _x2, _x3) {
				var _again = true;_function: while (_again) {
					var object = _x,
					    property = _x2,
					    receiver = _x3;desc = parent = getter = undefined;_again = false;if (object === null) object = Function.prototype;var desc = Object.getOwnPropertyDescriptor(object, property);if (desc === undefined) {
						var parent = Object.getPrototypeOf(object);if (parent === null) {
							return undefined;
						} else {
							_x = parent;_x2 = property;_x3 = receiver;_again = true;continue _function;
						}
					} else if ("value" in desc) {
						return desc.value;
					} else {
						var getter = desc.get;if (getter === undefined) {
							return undefined;
						}return getter.call(receiver);
					}
				}
			};

			function _interopRequireDefault(obj) {
				return obj && obj.__esModule ? obj : { "default": obj };
			}

			function _classCallCheck(instance, Constructor) {
				if (!(instance instanceof Constructor)) {
					throw new TypeError("Cannot call a class as a function");
				}
			}

			function _inherits(subClass, superClass) {
				if (typeof superClass !== "function" && superClass !== null) {
					throw new TypeError("Super expression must either be null or a function, not " + typeof superClass);
				}subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } });if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass;
			}

			var _react = _dereq_("react");

			var _react2 = _interopRequireDefault(_react);

			var WidthFill = (function (_React$Component) {
				_inherits(WidthFill, _React$Component);

				function WidthFill() {
					_classCallCheck(this, WidthFill);

					_get(Object.getPrototypeOf(WidthFill.prototype), "constructor", this).apply(this, arguments);
				}

				_createClass(WidthFill, [{
					key: "render",
					value: function render() {
						return _react2["default"].createElement("svg", { viewBox: "0 0 24 17" }, _react2["default"].createElement("g", null, _react2["default"].createElement("path", { d: "m 3.2525423,8.5338983 16.5903457,0", style: { strokeWidth: 2 } }), _react2["default"].createElement("path", { d: "M 3.4690633,11.727926 0.0563563,8.3988265 3.4645013,5.3568195", style: { strokeWidth: 0 } }), _react2["default"].createElement("path", { d: "m 19.249675,5.3577067 3.412707,3.3291 -3.408145,3.0420063", style: { strokeWidth: 0 } })));
					}
				}]);

				return WidthFill;
			})(_react2["default"].Component);

			exports["default"] = WidthFill;
			module.exports = exports["default"];
		}, { "react": "react" }], 24: [function (_dereq_, module, exports) {
			"use strict";

			Object.defineProperty(exports, "__esModule", {
				value: true
			});

			var _createClass = (function () {
				function defineProperties(target, props) {
					for (var i = 0; i < props.length; i++) {
						var descriptor = props[i];descriptor.enumerable = descriptor.enumerable || false;descriptor.configurable = true;if ("value" in descriptor) descriptor.writable = true;Object.defineProperty(target, descriptor.key, descriptor);
					}
				}return function (Constructor, protoProps, staticProps) {
					if (protoProps) defineProperties(Constructor.prototype, protoProps);if (staticProps) defineProperties(Constructor, staticProps);return Constructor;
				};
			})();

			var _get = function get(_x, _x2, _x3) {
				var _again = true;_function: while (_again) {
					var object = _x,
					    property = _x2,
					    receiver = _x3;desc = parent = getter = undefined;_again = false;if (object === null) object = Function.prototype;var desc = Object.getOwnPropertyDescriptor(object, property);if (desc === undefined) {
						var parent = Object.getPrototypeOf(object);if (parent === null) {
							return undefined;
						} else {
							_x = parent;_x2 = property;_x3 = receiver;_again = true;continue _function;
						}
					} else if ("value" in desc) {
						return desc.value;
					} else {
						var getter = desc.get;if (getter === undefined) {
							return undefined;
						}return getter.call(receiver);
					}
				}
			};

			function _interopRequireDefault(obj) {
				return obj && obj.__esModule ? obj : { "default": obj };
			}

			function _classCallCheck(instance, Constructor) {
				if (!(instance instanceof Constructor)) {
					throw new TypeError("Cannot call a class as a function");
				}
			}

			function _inherits(subClass, superClass) {
				if (typeof superClass !== "function" && superClass !== null) {
					throw new TypeError("Super expression must either be null or a function, not " + typeof superClass);
				}subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } });if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass;
			}

			var _react = _dereq_("react");

			var _react2 = _interopRequireDefault(_react);

			var _apiApi = _dereq_("../api/api");

			var _apiApi2 = _interopRequireDefault(_apiApi);

			var _apiActions = _dereq_("../api/actions");

			var _apiStore = _dereq_("../api/store");

			var _apiStore2 = _interopRequireDefault(_apiStore);

			var _utilRequestAnimationFrame = _dereq_('../util/request-animation-frame');

			var RESIZE_DELAY = 5;

			var MOUSE_UP = 0;
			var MOUSE_DOWN = 1;

			var Minimap = (function (_React$Component) {
				_inherits(Minimap, _React$Component);

				function Minimap(props) {
					_classCallCheck(this, Minimap);

					_get(Object.getPrototypeOf(Minimap.prototype), "constructor", this).call(this, props);
					this.api = new _apiApi2["default"](this.props.service, this.props.config);

					this.state = {
						width: null,
						height: null
					};

					this.resizeListener = this.onResize.bind(this);
					this.animationFrameListener = this.onAnimationFrame.bind(this);

					this.imageCtx = null;
					this.interactionCtx = null;
					this.resizeDelay = -1;
					this.mouseState = MOUSE_UP;
					this.mousemoveListener = this.onMouseMove.bind(this);
					this.mouseupListener = this.onMouseUp.bind(this);
					this.touchMoveListener = this.onTouchMove.bind(this);
				}

				_createClass(Minimap, [{
					key: "componentDidMount",
					value: function componentDidMount() {
						var _this = this;

						this.onResize();
						this.imageCtx = _react2["default"].findDOMNode(this).children[0].getContext('2d');
						this.interactionCtx = _react2["default"].findDOMNode(this).children[1].getContext('2d');
						window.addEventListener("resize", this.resizeListener);
						window.addEventListener("mousemove", this.mousemoveListener);
						window.addEventListener("mouseup", this.mouseupListener);
						window.addEventListener("touchend", this.mouseupListener);
						window.addEventListener("touchmove", this.touchMoveListener);
						(0, _utilRequestAnimationFrame.requestAnimationFrame)(this.animationFrameListener);

						this.unsubscribe = _apiStore2["default"].subscribe(function () {
							return _this.setState(_apiStore2["default"].getState());
						});
					}
				}, {
					key: "componentWillReceiveProps",
					value: function componentWillReceiveProps(nextProps) {
						if (nextProps.config.identifier !== this.props.config.identifier) {
							this.api = new _apiApi2["default"](this.props.service, nextProps.config);
							this.commitResize();
						}
					}
				}, {
					key: "shouldComponentUpdate",
					value: function shouldComponentUpdate(nextProps, nextState) {
						return this.state.width !== nextState.width || this.state.height !== nextState.height || this.props.config.identifier !== nextProps.config.identifier;
					}
				}, {
					key: "componentWillUnmount",
					value: function componentWillUnmount() {
						window.removeEventListener("resize", this.resizeListener);
						window.removeEventListener("mousemove", this.mousemoveListener);
						window.removeEventListener("mouseup", this.mouseupListener);
						window.addEventListener("touchend", this.mouseupListener);
						window.removeEventListener("touchmove", this.touchMoveListener);
						(0, _utilRequestAnimationFrame.cancelAnimationFrame)(this.animationFrameListener);
						this.unsubscribe();
					}
				}, {
					key: "onAnimationFrame",
					value: function onAnimationFrame() {
						if (this.resizeDelay === 0) {
							this.commitResize();
							this.resizeDelay = -1;
						} else if (this.resizeDelay > 0) {
							this.resizeDelay--;
						}

						this.interactionCtx.strokeStyle = this.props.rectStroke;
						this.interactionCtx.fillStyle = this.props.rectFill;
						this.interactionCtx.clearRect(0, 0, this.state.width, this.state.height);
						this.interactionCtx.fillRect(Math.floor(this.state.realViewPort.x * this.state.width), Math.floor(this.state.realViewPort.y * this.state.height), Math.ceil(this.state.realViewPort.w * this.state.width), Math.ceil(this.state.realViewPort.h * this.state.height));

						this.interactionCtx.beginPath();
						this.interactionCtx.rect(Math.floor(this.state.realViewPort.x * this.state.width), Math.floor(this.state.realViewPort.y * this.state.height), Math.ceil(this.state.realViewPort.w * this.state.width), Math.ceil(this.state.realViewPort.h * this.state.height));
						this.interactionCtx.stroke();

						(0, _utilRequestAnimationFrame.requestAnimationFrame)(this.animationFrameListener);
					}
				}, {
					key: "onResize",
					value: function onResize() {
						this.resizeDelay = RESIZE_DELAY;
					}
				}, {
					key: "commitResize",
					value: function commitResize() {
						this.resizing = false;
						this.resizeDelay = RESIZE_DELAY;
						var node = _react2["default"].findDOMNode(this);
						this.api.loadImage({
							viewport: { w: node.clientWidth, h: node.clientHeight },
							onTile: this.renderTile.bind(this),
							onScale: this.setScale.bind(this),
							scaleMode: "autoFill",
							position: { x: 0, y: 0 }
						});
					}
				}, {
					key: "setScale",
					value: function setScale(s, l) {
						this.scale = s;
						this.level = l;
						var dims = this.api.getRealImagePos({ x: 0, y: 0 }, this.scale, this.level);
						this.setState({ width: dims.w, height: dims.h });
					}
				}, {
					key: "renderTile",
					value: function renderTile(tileIm, tile) {
						var _imageCtx;

						(_imageCtx = this.imageCtx).drawImage.apply(_imageCtx, [tileIm, parseInt(Math.floor(tile.pos.x * this.scale)), parseInt(Math.floor(tile.pos.y * this.scale)), parseInt(Math.ceil(tileIm.width * this.scale)), parseInt(Math.ceil(tileIm.height * this.scale))]);
					}
				}, {
					key: "dispatchReposition",
					value: function dispatchReposition(ev) {
						var rect = _react2["default"].findDOMNode(this).getBoundingClientRect();
						_apiStore2["default"].dispatch((0, _apiActions.setRealViewPort)({
							x: (ev.pageX - rect.left) / this.state.width - this.state.realViewPort.w / 2,
							y: (ev.pageY - rect.top) / this.state.height - this.state.realViewPort.h / 2,
							reposition: true,
							applyZoom: false
						}));
					}
				}, {
					key: "onTouchStart",
					value: function onTouchStart(ev) {
						this.mouseState = MOUSE_DOWN;
						this.dispatchReposition({ pageX: ev.touches[0].pageX, pageY: ev.touches[0].pageY });
						return ev.preventDefault();
					}
				}, {
					key: "onMouseDown",
					value: function onMouseDown(ev) {
						this.mouseState = MOUSE_DOWN;
						this.dispatchReposition(ev);
					}
				}, {
					key: "onMouseMove",
					value: function onMouseMove(ev) {
						if (this.mouseState === MOUSE_DOWN) {
							this.dispatchReposition(ev);
							return ev.preventDefault();
						}
					}
				}, {
					key: "onTouchMove",
					value: function onTouchMove(ev) {
						if (this.mouseState === MOUSE_DOWN) {
							this.dispatchReposition({ pageX: ev.touches[0].pageX, pageY: ev.touches[0].pageY });
							return ev.preventDefault();
						}
					}
				}, {
					key: "onMouseUp",
					value: function onMouseUp(ev) {
						this.mouseState = MOUSE_UP;
					}
				}, {
					key: "onWheel",
					value: function onWheel(ev) {
						_apiStore2["default"].dispatch((0, _apiActions.sendMouseWheel)({ deltaY: ev.deltaY }));
						return ev.preventDefault();
					}
				}, {
					key: "onTouchEnd",
					value: function onTouchEnd(ev) {
						this.mouseState = MOUSE_UP;
					}
				}, {
					key: "render",
					value: function render() {
						return _react2["default"].createElement("div", { className: "hire-djakota-minimap" }, _react2["default"].createElement("canvas", { className: "image", height: this.state.height, width: this.state.width }), _react2["default"].createElement("canvas", { className: "interaction",
							height: this.state.height,
							onMouseDown: this.onMouseDown.bind(this),
							onTouchStart: this.onTouchStart.bind(this),
							onWheel: this.onWheel.bind(this),
							width: this.state.width }));
					}
				}]);

				return Minimap;
			})(_react2["default"].Component);

			Minimap.propTypes = {
				config: _react2["default"].PropTypes.object.isRequired,
				rectFill: _react2["default"].PropTypes.string,
				rectStroke: _react2["default"].PropTypes.string,
				service: _react2["default"].PropTypes.string.isRequired
			};

			Minimap.defaultProps = {
				rectFill: "rgba(128,128,255,0.1)",
				rectStroke: "rgba(255,255,255,0.8)"
			};

			exports["default"] = Minimap;
			module.exports = exports["default"];
		}, { "../api/actions": 15, "../api/api": 16, "../api/store": 18, "../util/request-animation-frame": 27, "react": "react" }], 25: [function (_dereq_, module, exports) {
			"use strict";

			Object.defineProperty(exports, "__esModule", {
				value: true
			});

			var _createClass = (function () {
				function defineProperties(target, props) {
					for (var i = 0; i < props.length; i++) {
						var descriptor = props[i];descriptor.enumerable = descriptor.enumerable || false;descriptor.configurable = true;if ("value" in descriptor) descriptor.writable = true;Object.defineProperty(target, descriptor.key, descriptor);
					}
				}return function (Constructor, protoProps, staticProps) {
					if (protoProps) defineProperties(Constructor.prototype, protoProps);if (staticProps) defineProperties(Constructor, staticProps);return Constructor;
				};
			})();

			var _get = function get(_x, _x2, _x3) {
				var _again = true;_function: while (_again) {
					var object = _x,
					    property = _x2,
					    receiver = _x3;desc = parent = getter = undefined;_again = false;if (object === null) object = Function.prototype;var desc = Object.getOwnPropertyDescriptor(object, property);if (desc === undefined) {
						var parent = Object.getPrototypeOf(object);if (parent === null) {
							return undefined;
						} else {
							_x = parent;_x2 = property;_x3 = receiver;_again = true;continue _function;
						}
					} else if ("value" in desc) {
						return desc.value;
					} else {
						var getter = desc.get;if (getter === undefined) {
							return undefined;
						}return getter.call(receiver);
					}
				}
			};

			function _interopRequireDefault(obj) {
				return obj && obj.__esModule ? obj : { "default": obj };
			}

			function _classCallCheck(instance, Constructor) {
				if (!(instance instanceof Constructor)) {
					throw new TypeError("Cannot call a class as a function");
				}
			}

			function _inherits(subClass, superClass) {
				if (typeof superClass !== "function" && superClass !== null) {
					throw new TypeError("Super expression must either be null or a function, not " + typeof superClass);
				}subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } });if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass;
			}

			var _react = _dereq_("react");

			var _react2 = _interopRequireDefault(_react);

			var _apiActions = _dereq_("../api/actions");

			var _apiStore = _dereq_("../api/store");

			var _apiStore2 = _interopRequireDefault(_apiStore);

			var MOUSE_UP = 0;
			var MOUSE_DOWN = 1;

			var Zoom = (function (_React$Component) {
				_inherits(Zoom, _React$Component);

				function Zoom(props) {
					_classCallCheck(this, Zoom);

					_get(Object.getPrototypeOf(Zoom.prototype), "constructor", this).call(this, props);
					this.state = _apiStore2["default"].getState();
					this.mouseupListener = this.onMouseUp.bind(this);
					this.mousemoveListener = this.onMouseMove.bind(this);
					this.touchMoveListener = this.onTouchMove.bind(this);
				}

				_createClass(Zoom, [{
					key: "componentDidMount",
					value: function componentDidMount() {
						var _this = this;

						window.addEventListener("mouseup", this.mouseupListener);
						window.addEventListener("mousemove", this.mousemoveListener);
						window.addEventListener("touchend", this.mouseupListener);
						window.addEventListener("touchmove", this.touchMoveListener);
						this.unsubscribe = _apiStore2["default"].subscribe(function () {
							return _this.setState(_apiStore2["default"].getState());
						});
					}
				}, {
					key: "componentWillUnmount",
					value: function componentWillUnmount() {
						window.removeEventListener("mouseup", this.mouseupListener);
						window.removeEventListener("mousemove", this.mousemoveListener);
						window.removeEventListener("touchend", this.mouseupListener);
						window.removeEventListener("touchmove", this.touchMoveListener);
						this.unsubscribe();
					}
				}, {
					key: "dispatchRealScale",
					value: function dispatchRealScale(pageX) {
						var rect = _react2["default"].findDOMNode(this).children[0].getBoundingClientRect();
						if (rect.width > 0 && !this.state.realViewPort.applyZoom) {
							var zoom = (pageX - rect.left) / rect.width * 2;
							if (zoom < 0.01) {
								zoom = 0.01;
							} else if (zoom > 2.0) {
								zoom = 2.0;
							}
							_apiStore2["default"].dispatch((0, _apiActions.setRealViewPort)({
								zoom: zoom,
								applyZoom: true
							}));
						}
					}
				}, {
					key: "onMouseDown",
					value: function onMouseDown(ev) {
						this.mouseState = MOUSE_DOWN;
						this.dispatchRealScale(ev.pageX);
					}
				}, {
					key: "onTouchStart",
					value: function onTouchStart(ev) {
						this.mouseState = MOUSE_DOWN;
						this.dispatchRealScale(ev.touches[0].pageX);
						return ev.preventDefault();
					}
				}, {
					key: "onMouseMove",
					value: function onMouseMove(ev) {
						if (this.mouseState === MOUSE_DOWN) {
							this.dispatchRealScale(ev.pageX);
							return ev.preventDefault();
						}
					}
				}, {
					key: "onTouchMove",
					value: function onTouchMove(ev) {
						if (this.mouseState === MOUSE_DOWN) {
							this.dispatchRealScale(ev.touches[0].pageX);
							return ev.preventDefault();
						}
					}
				}, {
					key: "onMouseUp",
					value: function onMouseUp(ev) {
						this.mouseState = MOUSE_UP;
					}
				}, {
					key: "onWheel",
					value: function onWheel(ev) {
						_apiStore2["default"].dispatch((0, _apiActions.sendMouseWheel)({ deltaY: ev.deltaY }));
						return ev.preventDefault();
					}
				}, {
					key: "render",
					value: function render() {
						var zoom = parseInt(this.state.realViewPort.zoom * 100);
						return _react2["default"].createElement("span", { className: "hire-zoom-bar", onWheel: this.onWheel.bind(this) }, _react2["default"].createElement("svg", {
							onMouseDown: this.onMouseDown.bind(this),
							onTouchStart: this.onTouchStart.bind(this),
							viewBox: "-12 0 224 24" }, _react2["default"].createElement("path", { d: "M0 12 L 200 12 Z" }), _react2["default"].createElement("circle", { cx: zoom > 200 ? 200 : zoom, cy: "12", r: "12" })), _react2["default"].createElement("label", null, zoom, "%"));
					}
				}]);

				return Zoom;
			})(_react2["default"].Component);

			Zoom.propTypes = {
				fill: _react2["default"].PropTypes.string,
				stroke: _react2["default"].PropTypes.string
			};

			Zoom.defaultProps = {
				fill: "rgba(0,0,0, 0.7)",
				stroke: "rgba(0,0,0, 1)"
			};

			exports["default"] = Zoom;
			module.exports = exports["default"];
		}, { "../api/actions": 15, "../api/store": 18, "react": "react" }], 26: [function (_dereq_, module, exports) {
			"use strict";

			Object.defineProperty(exports, "__esModule", {
				value: true
			});

			function _interopRequireDefault(obj) {
				return obj && obj.__esModule ? obj : { "default": obj };
			}

			var _insertCss = _dereq_("insert-css");

			var _insertCss2 = _interopRequireDefault(_insertCss);

			var _react = _dereq_("react");

			var _react2 = _interopRequireDefault(_react);

			var _componentsDjakotaClient = _dereq_("./components/djakota-client");

			var _componentsDjakotaClient2 = _interopRequireDefault(_componentsDjakotaClient);

			var _componentsMinimap = _dereq_("./components/minimap");

			var _componentsMinimap2 = _interopRequireDefault(_componentsMinimap);

			var _componentsZoom = _dereq_("./components/zoom");

			var _componentsZoom2 = _interopRequireDefault(_componentsZoom);

			var _componentsFillButton = _dereq_("./components/fill-button");

			var _componentsFillButton2 = _interopRequireDefault(_componentsFillButton);

			var css = Buffer("LmhpcmUtZGpha290YS1jbGllbnQsCi5oaXJlLWRqYWtvdGEtbWluaW1hcCB7Cgl3aWR0aDogMTAwJTsKCWhlaWdodDogMTAwJTsKfQoKLmhpcmUtZGpha290YS1jbGllbnQgPiAuaW50ZXJhY3Rpb24sCi5oaXJlLWRqYWtvdGEtY2xpZW50ID4gLmltYWdlLAouaGlyZS1kamFrb3RhLW1pbmltYXAgPiAuaW50ZXJhY3Rpb24sCi5oaXJlLWRqYWtvdGEtbWluaW1hcCA+IC5pbWFnZSB7Cglwb3NpdGlvbjogYWJzb2x1dGU7Cn0KCi5oaXJlLWRqYWtvdGEtY2xpZW50ID4gLmludGVyYWN0aW9uLAouaGlyZS1kamFrb3RhLW1pbmltYXAgPiAuaW50ZXJhY3Rpb24gewoJei1pbmRleDogMTsKfQoKLmhpcmUtem9vbS1iYXIgKiB7CiAgICAtbW96LXVzZXItc2VsZWN0OiBub25lOwogICAgLXdlYmtpdC11c2VyLXNlbGVjdDogbm9uZTsKICAgIC1tcy11c2VyLXNlbGVjdDogbm9uZTsgCiAgICB1c2VyLXNlbGVjdDogbm9uZTsgCiAgICAtd2Via2l0LXVzZXItZHJhZzogbm9uZTsKICAgIHVzZXItZHJhZzogbm9uZTsKfQouaGlyZS16b29tLWJhciB7CglkaXNwbGF5OiBpbmxpbmUtYmxvY2s7CgltaW4td2lkdGg6IDQwMHB4OwoJbWluLWhlaWdodDogNDRweDsKfQoKLmhpcmUtem9vbS1iYXIgbGFiZWwgewoJZGlzcGxheTogaW5saW5lLWJsb2NrOwoJd2lkdGg6IDE1JTsKCWhlaWdodDogMTAwJTsKCXZlcnRpY2FsLWFsaWduOiB0b3A7Cn0KLmhpcmUtem9vbS1iYXIgbGFiZWwgPiAqIHsKCWRpc3BsYXk6IGlubGluZS1ibG9jazsKCWhlaWdodDogMTAwJTsKCWxpbmUtaGVpZ2h0OiAzNHB4Cn0KLmhpcmUtem9vbS1iYXIgc3ZnIHsKCWN1cnNvcjogcG9pbnRlcjsKCWZpbGw6ICNCREE0N0U7CglzdHJva2U6ICNGMUVCRTY7Cgl3aWR0aDogODUlOwp9CgouaGlyZS16b29tLWJhciBzdmcgcGF0aCB7CglzdHJva2Utd2lkdGg6IDZweDsKfQoKLmhpcmUtem9vbS1iYXIgc3ZnIGNpcmNsZSB7CglzdHJva2Utd2lkdGg6IDA7Cn0KCi5oaXJlLWZpbGwtYnV0dG9uIHsKCW1hcmdpbjogMDsKCXBhZGRpbmc6IDA7Cglib3JkZXI6IDA7CgliYWNrZ3JvdW5kOiB0cmFuc3BhcmVudDsKCWZvbnQtZmFtaWx5OiBpbmhlcml0OwoJY3Vyc29yOiBwb2ludGVyOwoJb3V0bGluZTogMDsKCXdpZHRoOiA1MHB4OwoJaGVpZ2h0OiAyNHB4OwoJcGFkZGluZzogMCA2cHg7CgliYWNrZ3JvdW5kLWNvbG9yOiAjQkRBNDdFOwoJbWFyZ2luLXJpZ2h0OiA2cHg7Cglib3JkZXItcmFkaXVzOiAzcHg7Cgljb2xvcjogI0YxRUJFNjsKCXZlcnRpY2FsLWFsaWduOiB0b3A7Cgp9CgoKLmhpcmUtZmlsbC1idXR0b246Oi1tb3otZm9jdXMtaW5uZXJ7CglwYWRkaW5nOiAwOwoJYm9yZGVyOiAwOwp9CgouaGlyZS1maWxsLWJ1dHRvbiBzdmcgewoJc3Ryb2tlOiAjRjFFQkU2OwoJc3Ryb2tlLXdpZHRoOiAxcHg7CglmaWxsOiAjRjFFQkU2OwoKCXN0cm9rZS1vcGFjaXR5OiAxOwoJaGVpZ2h0OiAxMDAlCn0K", "base64");
			(0, _insertCss2["default"])(css, { prepend: true });

			_react2["default"].initializeTouchEvents(true);
			exports.DjakotaClient = _componentsDjakotaClient2["default"];
			exports.Minimap = _componentsMinimap2["default"];
			exports.Zoom = _componentsZoom2["default"];
			exports.FillButton = _componentsFillButton2["default"];
			exports["default"] = _componentsDjakotaClient2["default"];
		}, { "./components/djakota-client": 19, "./components/fill-button": 20, "./components/minimap": 24, "./components/zoom": 25, "insert-css": 1, "react": "react" }], 27: [function (_dereq_, module, exports) {
			/*
   The MIT License (MIT)
   
   Copyright (c) 2015 Eryk Napierała
   
   Permission is hereby granted, free of charge, to any person obtaining a copy
   of this software and associated documentation files (the "Software"), to deal
   in the Software without restriction, including without limitation the rights
   to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
   copies of the Software, and to permit persons to whom the Software is
   furnished to do so, subject to the following conditions:
   
   The above copyright notice and this permission notice shall be included in all
   copies or substantial portions of the Software.
   
   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
   IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
   FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
   AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
   LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
   OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
   SOFTWARE.
   https://github.com/erykpiast/request-animation-frame-shim/
   */

			'use strict';

			Object.defineProperty(exports, '__esModule', {
				value: true
			});
			var requestAnimationFrame = 'function' === typeof global.requestAnimationFrame ? function (cb) {
				return global.requestAnimationFrame(cb);
			} : 'function' === typeof global.webkitRequestAnimationFrame ? function (cb) {
				return global.webkitRequestAnimationFrame(cb);
			} : 'function' === typeof global.mozRequestAnimationFrame ? function (cb) {
				return global.mozRequestAnimationFrame(cb);
			} : undefined;

			exports.requestAnimationFrame = requestAnimationFrame;
			var cancelAnimationFrame = 'function' === typeof global.cancelAnimationFrame ? function (cb) {
				return global.cancelAnimationFrame(cb);
			} : 'function' === typeof global.webkitCancelAnimationFrame ? function (cb) {
				return global.webkitCancelAnimationFrame(cb);
			} : 'function' === typeof global.webkitCancelRequestAnimationFrame ? function (cb) {
				return global.webkitCancelRequestAnimationFrame(cb);
			} : 'function' === typeof global.mozCancelAnimationFrame ? function (cb) {
				return global.mozCancelAnimationFrame(cb);
			} : undefined;
			exports.cancelAnimationFrame = cancelAnimationFrame;
		}, {}] }, {}, [26])(26);
});

}).call(this,require('_process'),typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer)
},{"_process":5,"buffer":1}]},{},[6])(6)
});