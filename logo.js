//
// Logo Interpreter in Javascript
//

// Copyright (C) 2011 Joshua Bell
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

function LogoInterpreter(turtle, stream, savehook)
{
  'use strict';

  var self = this;

  var UNARY_MINUS = '<UNARYMINUS>'; // Must not parse as a word

  //----------------------------------------------------------------------
  //
  // Utilities
  //
  //----------------------------------------------------------------------

  function format(string, params) {
    return string.replace(/{(\w+)(:[UL])?}/g, function(m, n, o) {
      var s = (n === '_PROC_') ? self.stack[self.stack.length - 1] : String(params[n]);
      switch (o) {
        case ':U': return s.toUpperCase();
        case ':L': return s.toLowerCase();
        default: return s;
      }
    });
  }

  // To support localized/customized messages, assign a lookup function:
  // instance.localize = function(s) {
  //   return {
  //     'Division by zero': 'Divido per nulo',
  //     'Index out of bounds': 'Indekso ekster limojn',
  //     ...
  //   }[s];
  // };
  this.localize = null;
  function __(string) {
    if (self.localize)
      return self.localize(string) || string;
    return string;
  }

  // Shortcut for common use of format() and __()
  function err(string, params) {
    return new Error(format(__(string), params));
  }


  // To handle additional keyword aliases (localizations, etc), assign
  // a function to keywordAlias. Input will be the uppercased word,
  // output must be one of the keywords (ELSE or END), or undefined.
  // For example:
  // logo.keywordAlias = function(name) {
  //   return {
  //     'ALIE': 'ELSE',
  //     'FINO': 'END'
  //     ...
  //   }[name];
  // };
  this.keywordAlias = null;
  function isKeyword(atom, match) {
    if (Type(atom) !== 'word')
      return false;
    atom = String(atom).toUpperCase();
    if (self.keywordAlias)
      atom = self.keywordAlias(atom) || atom;
    return atom === match;
  }

  // Returns a promise; calls the passed function with (loop, resolve,
  // reject). Calling resolve or reject (or throwing) settles the
  // promise, calling loop repeats.
  function promiseLoop(func) {
    return new Promise(function(resolve, reject) {
      (function loop() {
        try {
          func(loop, resolve, reject);
        } catch (e) {
          reject(e);
        }
      }());
    });
  }

  // Takes a list of (possibly async) closures. Each is called in
  // turn, waiting for its result to resolve before the next is
  // executed. Resolves to an array of results, or rejects if any
  // closure rejects.
  function serialExecute(funcs) {
    var results = [];
    return promiseLoop(function(loop, resolve, reject) {
      if (!funcs.length) {
        resolve(results);
        return;
      }
      Promise.resolve(funcs.shift()())
        .then(function(result) {
          results.push(result);
          loop();
        }, reject);
    });
  }

  // Returns a promise with the same result as the passed promise, but
  // that executes finalBlock before it resolves, regardless of
  // whether it fulfills or rejects.
  function promiseFinally(promise, finalBlock) {
    return promise
      .then(function(result) {
        return Promise.resolve(finalBlock())
          .then(function() {
            return result;
          });
      }, function(err) {
        return Promise.resolve(finalBlock())
          .then(function() {
            throw err;
          });
      });
  }

  // Returns a Promise that will resolve after yielding control to the
  // event loop.
  function promiseYield() {
    return new Promise(function(resolve) {
      setTimeout(resolve, 0);
    });
  }

  // Based on: https://www.jbouchard.net/chris/blog/2008/01/currying-in-javascript-fun-for-whole.html
  // Argument is `$$func$$` to avoid issue if passed function is named `func`.
  function to_arity($$func$$, arity) {
    var parms = [];

    if ($$func$$.length === arity)
      return $$func$$;

    for (var i = 0; i < arity; i += 1)
      parms.push('a' + i);

    var f = eval('(function ' + $$func$$.name + '(' + parms.join(',') + ')' +
                 '{ return $$func$$.apply(this, arguments); })');
    return f;
  }


  //----------------------------------------------------------------------
  //
  // Classes
  //
  //----------------------------------------------------------------------

  // Adapted from:
  // https://stackoverflow.com/questions/424292/how-to-create-my-own-javascript-random-number-generator-that-i-can-also-set-the-s
  function PRNG(seed) {
    var S = seed & 0x7fffffff, // seed
        A = 48271, // const
        M = 0x7fffffff, // const
        Q = M / A, // const
        R = M % A; // const

    this.next = function PRNG_next() {
      var hi = S / Q,
          lo = S % Q,
          t = A * lo - R * hi;
      S = (t > 0) ? t : t + M;
      this.last = S / M;
      return this.last;
    };
    this.seed = function PRNG_seed(x) {
      S = x & 0x7fffffff;
    };
    this.next();
  }

  function StringMap(case_fold) {
    var map = new Map();
    Object.assign(this, {
      get: function(key) {
        key = case_fold ? String(key).toLowerCase() : String(key);
        return map.get(key);
      },
      set: function(key, value) {
        key = case_fold ? String(key).toLowerCase() : String(key);
        map.set(key, value);
      },
      has: function(key) {
        key = case_fold ? String(key).toLowerCase() : String(key);
        return map.has(key);
      },
      delete: function(key) {
        key = case_fold ? String(key).toLowerCase() : String(key);
        return map.delete(key);
      },
      keys: function() {
        var keys = [];
        map.forEach(function(value, key) { keys.push(key); });
        return keys;
      },
      empty: function() {
        return map.size === 0;
      },
      forEach: function(fn) {
        return map.forEach(function(value, key) {
          fn(key, value);
        });
      }
    });
  }

  function LogoArray(size, origin) {
    this.array = [];
    this.array.length = size;
    for (var i = 0; i < this.array.length; ++i)
      this.array[i] = [];
    this.origin = origin;
  }
  LogoArray.from = function(list, origin) {
    var array = new LogoArray(0, origin);
    array.array = Array.from(list);
    return array;
  };
  LogoArray.prototype = {
    item: function(i) {
      i = Number(i)|0;
      i -= this.origin;
      if (i < 0 || i >= this.array.length)
        throw err("{_PROC_}: Index out of bounds");
      return this.array[i];
    },
    setItem: function(i, v) {
      i = Number(i)|0;
      i -= this.origin;
      if (i < 0 || i >= this.array.length)
        throw err("{_PROC_}: Index out of bounds");
      this.array[i] = v;
    },
    list: function() {
      return this.array;
    },
    count: function() {
      return this.array.length;
    }
  };

  function Stream(string) {
    this.string = string;
    this.index = 0;
    this._skip();
  }
  Stream.prototype = {
    eof: function() {
      return this.index >= this.string.length;
    },
    peek: function() {
      var c = this.string.charAt(this.index);
      if (c === '\\')
        c += this.string.charAt(this.index + 1);
      return c;
    },
    get: function() {
      var c = this._next();
      this._skip();
      return c;
    },
    _next: function() {
      var c = this.string.charAt(this.index++);
      if (c === '\\')
        c += this.string.charAt(this.index++);
      return c;
    },
    _skip: function() {
      while (!this.eof()) {
        var c = this.peek();
        if (c === '~' && this.string.charAt(this.index + 1) === '\n') {
          this.index += 2;
        } else if (c === ';') {
          do {
            c = this._next();
          } while (!this.eof() && this.peek() !== '\n');
          if (c === '~')
            this._next();
        } else {
          return;
        }
      }
    },
    rest: function() {
      return this.string.substring(this.index);
    }
  };

  //----------------------------------------------------------------------
  //
  // Interpreter State
  //
  //----------------------------------------------------------------------

  self.turtle = turtle;
  self.stream = stream;
  self.routines = new StringMap(true);
  self.scopes = [new StringMap(true)];
  self.plists = new StringMap(true);
  self.prng = new PRNG(Math.random() * 0x7fffffff);
  self.forceBye = false;

  //----------------------------------------------------------------------
  //
  // Parsing
  //
  //----------------------------------------------------------------------

  // Used to return values from routines (thrown/caught)
  function Output(output) { this.output = output; }
  Output.prototype.toString = function() { return this.output; };
  Output.prototype.valueOf = function() { return this.output; };

  // Used to stop processing cleanly
  function Bye() { }

  function Type(atom) {
    if (atom === undefined) {
      // TODO: Should be caught higher upstream than this
      throw err("No output from procedure");
    } else if (typeof atom === 'string' || typeof atom === 'number') {
      return 'word';
    } else if (Array.isArray(atom)) {
      return 'list';
    } else if (atom instanceof LogoArray) {
      return 'array';
    } else if ('then' in Object(atom)) {
      throw new Error("Internal error: Unexpected value: a promise");
    } else if (!atom) {
      throw new Error("Internal error: Unexpected value: null");
    } else {
      throw new Error("Internal error: Unexpected value: unknown type");
    }
  }


  //
  // Tokenize into atoms / lists
  //
  // Input: string
  // Output: atom list (e.g. "to", "jump", "repeat", "random", 10, [ "fd", "10", "rt", "10" ], "end"
  //

  function parse(string) {
    if (string === undefined) {
      return undefined; // TODO: Replace this with ...?
    }

    var atoms = [],
        prev, r;

    var stream = new Stream(string);
    while (stream.peek()) {
      var atom;

      // Ignore (but track) leading space - needed for unary minus disambiguation
      var leading_space = isWS(stream.peek());
      while (isWS(stream.peek()))
        stream.get();
      if (!stream.peek())
        break;

      if (stream.peek() === '[') {
        stream.get();
        atom = parseList(stream);
      } else if (stream.peek() === '{') {
        stream.get();
        atom = parseArray(stream);
      } else if (stream.peek() === '"') {
        atom = parseQuoted(stream);
      } else if (isOwnWord(stream.peek())) {
        atom = stream.get();
      } else if (inRange(stream.peek(), '0', '9')) {
        atom = parseNumber(stream);
      } else if (inChars(stream.peek(), OPERATOR_CHARS)) {
        atom = parseOperator(stream);
        // From UCB Logo:

        // Minus sign means infix difference in ambiguous contexts
        // (when preceded by a complete expression), unless it is
        // preceded by a space and followed by a nonspace.

        // Minus sign means unary minus if the previous token is an
        // infix operator or open parenthesis, or it is preceded by a
        // space and followed by a nonspace.

        if (atom === '-') {
          var trailing_space = isWS(stream.peek());
          if (prev === undefined ||
              (Type(prev) === 'word' && isInfix(prev)) ||
              (Type(prev) === 'word' && prev === '(') ||
              (leading_space && !trailing_space)) {
            atom = UNARY_MINUS;
          }
        }
      } else if (!inChars(stream.peek(), WORD_DELIMITER)) {
        atom = parseWord(stream);
      } else {
        throw err("Couldn't parse: '{string}'", { string: stream.rest() });
      }
      atoms.push(atom);
      prev = atom;
    }

    return atoms;
  }

  function inRange(x, a, b) {
    return a <= x && x <= b;
  }

  function inChars(x, chars) {
    return x && chars.indexOf(x) !== -1;
  }

  var WS_CHARS = ' \f\n\r\t\v';
  function isWS(c) {
    return inChars(c, WS_CHARS);
  }

  // "After a quotation mark outside square brackets, a word is
  // delimited by a space, a square bracket, or a parenthesis."
  var QUOTED_DELIMITER = WS_CHARS + '[](){}';
  function parseQuoted(stream) {
    var word = '';
    while (!stream.eof() && QUOTED_DELIMITER.indexOf(stream.peek()) === -1) {
      var c = stream.get();
      word += (c.charAt(0) === '\\') ? c.charAt(1) : c.charAt(0);
    }
    return word;
  }

  // Non-standard: U+2190 ... U+2193 are arrows, parsed as own-words.
  var OWNWORD_CHARS = '\u2190\u2191\u2192\u2193';
  function isOwnWord(c) {
    return inChars(c, OWNWORD_CHARS);
  }

  // "A word not after a quotation mark or inside square brackets is
  // delimited by a space, a bracket, a parenthesis, or an infix
  // operator +-*/=<>. Note that words following colons are in this
  // category. Note that quote and colon are not delimiters."
  var WORD_DELIMITER = WS_CHARS + '[](){}+-*/%^=<>';
  function parseWord(stream) {
    var word = '';
    while (!stream.eof() && WORD_DELIMITER.indexOf(stream.peek()) === -1) {
      var c = stream.get();
      word += (c.charAt(0) === '\\') ? c.charAt(1) : c.charAt(0);
    }
    return word;
  }

  // "Each infix operator character is a word in itself, except that
  // the two-character sequences <=, >=, and <> (the latter meaning
  // not-equal) with no intervening space are recognized as a single
  // word."
  var OPERATOR_CHARS = '+-*/%^=<>[]{}()';
  function parseOperator(stream) {
    var word = '';
    if (inChars(stream.peek(), OPERATOR_CHARS))
      word += stream.get();
    if ((word === '<' && stream.peek() === '=') ||
        (word === '>' && stream.peek() === '=') ||
        (word === '<' && stream.peek() === '>')) {
      word += stream.get();
    }
    return word;
  }

  function isInfix(word) {
    return ['+', '-', '*', '/', '%', '^', '=', '<', '>', '<=', '>=', '<>']
      .includes(word);
  }

  function isOperator(word) {
    return isInfix(word) || ['[', ']', '{', '}', '(', ')'].includes(word);
  }

  // Non-standard: Numbers support exponential notation (e.g. 1.23e-45)
  function parseNumber(stream) {
    var word = '';
    while (inRange(stream.peek(), '0', '9'))
      word += stream.get();
    if (stream.peek() === '.')
      word += stream.get();
    if (inRange(stream.peek(), '0', '9')) {
      while (inRange(stream.peek(), '0', '9'))
        word += stream.get();
    }
    if (stream.peek() === 'E' || stream.peek() === 'e') {
      word += stream.get();
      if (stream.peek() === '-' || stream.peek() === '+')
        word += stream.get();
      while (inRange(stream.peek(), '0', '9'))
        word += stream.get();
    }
    return word;
  }

  // Includes leading - sign, unlike parseNumber().
  function isNumber(s) {
    return String(s).match(/^-?([0-9]*\.?[0-9]+(?:[eE][\-+]?[0-9]+)?)$/);
  }

  function parseInteger(stream) {
    var word = '';
    if (stream.peek() === '-')
      word += stream.get();
    while (inRange(stream.peek(), '0', '9'))
      word += stream.get();
    return word;
  }

  function parseList(stream) {
    var list = [],
        atom = '',
        c, r;

    while (true) {
      do {
        c = stream.get();
      } while (isWS(c));

      while (c && !isWS(c) && '[]{}'.indexOf(c) === -1) {
        atom += c;
        c = stream.get();
      }

      if (atom.length) {
        list.push(atom);
        atom = '';
      }

      if (!c)
        throw err("Expected ']'");
      if (isWS(c))
        continue;
      if (c === ']')
        return list;
      if (c === '[') {
        list.push(parseList(stream));
        continue;
      }
      if (c === '{') {
        list.push(parseArray(stream));
        continue;
      }
      throw err("Unexpected '{c}'", {c: c});
    }
  }

  function parseArray(stream) {
    var list = [],
        origin = 1,
        atom = '',
        c, r;

    while (true) {
      do {
        c = stream.get();
      } while (isWS(c));

      while (c && !isWS(c) && '[]{}'.indexOf(c) === -1) {
        atom += c;
        c = stream.get();
      }

      if (atom.length) {
        list.push(atom);
        atom = '';
      }

      if (!c)
        throw err("Expected '}'");
      if (isWS(c))
        continue;
      if (c === '}') {
        while (isWS(stream.peek()))
          stream.get();
        if (stream.peek() === '@') {
          stream.get();
          while (isWS(stream.peek()))
            stream.get();
          origin = parseInteger(stream);
          if (!origin) throw err("Expected number after @");
        }
        return LogoArray.from(list, origin);
      }
      if (c === '[') {
        list.push(parseList(stream));
        continue;
      }
      if (c === '{') {
        list.push(parseArray(stream));
        continue;
      }
      throw err("Unexpected '{c}'", {c: c});
    }
  }

  function reparse(list) {
    return parse(stringify_nodecorate(list).replace(/([\\;])/g, '\\$1'));
  }

  function maybegetvar(name) {
    var lval = lvalue(name);
    return lval ? lval.value : undefined;
  }

  function getvar(name) {
    var value = maybegetvar(name);
    if (value !== undefined)
      return value;
    throw err("Don't know about variable {name:U}", { name: name });
  }

  function lvalue(name) {
    for (var i = self.scopes.length - 1; i >= 0; --i) {
      if (self.scopes[i].has(name)) {
        return self.scopes[i].get(name);
      }
    }
    return undefined;
  }

  function setvar(name, value) {
    value = copy(value);

    // Find the variable in existing scope
    var lval = lvalue(name);
    if (lval) {
      lval.value = value;
    } else {
      // Otherwise, define a global
      lval = {value: value};
      self.scopes[0].set(name, lval);
    }
  }

  //----------------------------------------------------------------------
  //
  // Expression Evaluation
  //
  //----------------------------------------------------------------------

  // Expression               := RelationalExpression
  // RelationalExpression     := AdditiveExpression [ ( '=' | '<' | '>' | '<=' | '>=' | '<>' ) AdditiveExpression ... ]
  // AdditiveExpression       := MultiplicativeExpression [ ( '+' | '-' ) MultiplicativeExpression ... ]
  // MultiplicativeExpression := PowerExpression [ ( '*' | '/' | '%' ) PowerExpression ... ]
  // PowerExpression          := UnaryExpression [ '^' UnaryExpression ]
  // UnaryExpression          := ( '-' ) UnaryExpression
  //                           | FinalExpression
  // FinalExpression          := string-literal
  //                           | number-literal
  //                           | list
  //                           | variable-reference
  //                           | procedure-call
  //                           | '(' Expression ')'

  // Peek at the list to see if there are additional atoms from a set
  // of options.
  function peek(list, options) {
    if (list.length < 1) { return false; }
    var next = list[0];
    return options.some(function(x) { return next === x; });

  }

  function evaluateExpression(list) {
    return (expression(list))();
  }

  function expression(list) {
    return relationalExpression(list);
  }

  function relationalExpression(list) {
    var lhs = additiveExpression(list);
    var op;
    while (peek(list, ['=', '<', '>', '<=', '>=', '<>'])) {
      op = list.shift();

      lhs = function(lhs) {
        var rhs = additiveExpression(list);

        switch (op) {
          case "<": return defer(function(lhs, rhs) { return (aexpr(lhs) < aexpr(rhs)) ? 1 : 0; }, lhs, rhs);
          case ">": return defer(function(lhs, rhs) { return (aexpr(lhs) > aexpr(rhs)) ? 1 : 0; }, lhs, rhs);
          case "=": return defer(function(lhs, rhs) { return equal(lhs, rhs) ? 1 : 0; }, lhs, rhs);

          case "<=": return defer(function(lhs, rhs) { return (aexpr(lhs) <= aexpr(rhs)) ? 1 : 0; }, lhs, rhs);
          case ">=": return defer(function(lhs, rhs) { return (aexpr(lhs) >= aexpr(rhs)) ? 1 : 0; }, lhs, rhs);
          case "<>": return defer(function(lhs, rhs) { return !equal(lhs, rhs) ? 1 : 0; }, lhs, rhs);
          default: throw new Error("Internal error in expression parser");
        }
      } (lhs);
    }

    return lhs;
  }


  // Takes a function and list of (possibly async) closures. Returns a
  // closure that, when executed, evaluates the closures serially then
  // applies the function to the results.
  function defer(func /*, input...*/) {
    var input = Array.prototype.slice.call(arguments, 1);
    return function() {
      return serialExecute(input.slice())
        .then(function(args) {
          return func.apply(null, args);
        });
    };
  }

  function additiveExpression(list) {
    var lhs = multiplicativeExpression(list);
    var op;
    while (peek(list, ['+', '-'])) {
      op = list.shift();

      lhs = function(lhs) {
        var rhs = multiplicativeExpression(list);
        switch (op) {
          case "+": return defer(function(lhs, rhs) { return aexpr(lhs) + aexpr(rhs); }, lhs, rhs);
          case "-": return defer(function(lhs, rhs) { return aexpr(lhs) - aexpr(rhs); }, lhs, rhs);
          default: throw new Error("Internal error in expression parser");
        }
      } (lhs);
    }

    return lhs;
  }

  function multiplicativeExpression(list) {
    var lhs = powerExpression(list);
    var op;
    while (peek(list, ['*', '/', '%'])) {
      op = list.shift();

      lhs = function(lhs) {
        var rhs = powerExpression(list);
        switch (op) {
          case "*": return defer(function(lhs, rhs) { return aexpr(lhs) * aexpr(rhs); }, lhs, rhs);
          case "/": return defer(function(lhs, rhs) {
            var n = aexpr(lhs), d = aexpr(rhs);
            if (d === 0) { throw err("Division by zero"); }
            return n / d;
          }, lhs, rhs);
          case "%": return defer(function(lhs, rhs) {
            var n = aexpr(lhs), d = aexpr(rhs);
            if (d === 0) { throw err("Division by zero"); }
            return n % d;
          }, lhs, rhs);
          default: throw new Error("Internal error in expression parser");
        }
      } (lhs);
    }

    return lhs;
  }

  function powerExpression(list) {
    var lhs = unaryExpression(list);
    var op;
    while (peek(list, ['^'])) {
      op = list.shift();
      lhs = function(lhs) {
        var rhs = unaryExpression(list);
        return defer(function(lhs, rhs) { return Math.pow(aexpr(lhs), aexpr(rhs)); }, lhs, rhs);
      } (lhs);
    }

    return lhs;
  }

  function unaryExpression(list) {
    var rhs, op;

    if (peek(list, [UNARY_MINUS])) {
      op = list.shift();
      rhs = unaryExpression(list);
      return defer(function(rhs) { return -aexpr(rhs); }, rhs);
    } else {
      return finalExpression(list);
    }
  }

  function finalExpression(list) {
    if (!list.length)
      throw err("Unexpected end of instructions");

    var atom = list.shift();

    var result, literal, varname;

    switch (Type(atom)) {
    case 'array':
    case 'list':
      return function() { return atom; };

    case 'word':
      if (isNumber(atom)) {
        // number literal
        atom = parseFloat(atom);
        return function() { return atom; };
      }

      atom = String(atom);
      if (atom.charAt(0) === '"' || atom.charAt(0) === "'") {
        // string literal
        literal = atom.substring(1);
        return function() { return literal; };
      }
      if (atom.charAt(0) === ':') {
        // variable
        varname = atom.substring(1);
        return function() { return getvar(varname); };
      }
      if (atom === '(') {
        // parenthesized expression/procedure call
        if (list.length && Type(list[0]) === 'word' && self.routines.has(String(list[0])) &&
            !(list.length > 1 && Type(list[1]) === 'word' && isInfix(String(list[1])))) {
          // Lisp-style (procedure input ...) calling syntax
          atom = list.shift();
          return self.dispatch(atom, list, false);
        }
        // Standard parenthesized expression
        result = expression(list);

        if (!list.length)
          throw err("Expected ')'");
        if (!peek(list, [')']))
          throw err("Expected ')', saw {word}", { word: list.shift() });
        list.shift();
        return result;
      }
      // Procedure dispatch
      return self.dispatch(atom, list, true);

    default: throw new Error("Internal error in expression parser");
    }
  }

  self.stack = [];

  self.dispatch = function(name, tokenlist, natural) {
    name = name.toUpperCase();
    var procedure = self.routines.get(name);
    if (!procedure) {

      // Give a helpful message in a common error case.
      var m;
      if ((m = /^(\w+?)(\d+)$/.exec(name)) && self.routines.get(m[1])) {
        throw err("Need a space between {name:U} and {value}",
                  { name: m[1], value: m[2] });
      }

      throw err("Don't know how to {name:U}", { name: name });
    }

    if (procedure.special) {
      // Special routines are built-ins that get handed the token list:
      // * workspace modifiers like TO that special-case varnames
      self.stack.push(name);
      try {
        procedure(tokenlist);
        return function() { };
      } finally {
        self.stack.pop();
      }
    }

    var args = [];
    if (natural) {
      // Natural arity of the function
      for (var i = 0; i < procedure.length; ++i) {
        args.push(expression(tokenlist));
      }
    } else {
      // Caller specified argument count
      while (tokenlist.length && !peek(tokenlist, [')'])) {
        args.push(expression(tokenlist));
      }
      tokenlist.shift(); // Consume ')'
    }

    if (procedure.noeval) {
      return function() {
        self.stack.push(name);
        return promiseFinally(procedure.apply(null, args),
                              function() { self.stack.pop(); });
      };
    }

    return function() {
      self.stack.push(name);
      return promiseFinally(serialExecute(args).then(function(args) {
        return procedure.apply(null, args);
      }), function() { self.stack.pop(); });
    };
  };

  //----------------------------------------------------------------------
  // Arithmetic expression convenience function
  //----------------------------------------------------------------------
  function aexpr(atom) {
    if (atom === undefined) {
      throw err("Expected number");
    }
    switch (Type(atom)) {
    case 'word':
      if (isNumber(atom))
        return parseFloat(atom);
      break;
    }
    throw err("Expected number");
  }

  //----------------------------------------------------------------------
  // String expression convenience function
  //----------------------------------------------------------------------
  function sexpr(atom) {
    if (atom === undefined) throw err("Expected string");
    if (atom === UNARY_MINUS) return '-';
    if (Type(atom) === 'word') return String(atom);

    throw new err("Expected string");
  }

  //----------------------------------------------------------------------
  // List expression convenience function
  //----------------------------------------------------------------------

  // 'list expression'
  // Takes an atom - if it is a list is is returned unchanged. If it
  // is a word a list of the characters is returned. If the procedure
  // returns a list, the output type should match the input type, so
  // use sifw().
  function lexpr(atom) {
    if (atom === undefined)
      throw err("{_PROC_}: Expected list");
    switch (Type(atom)) {
    case 'word':
      return Array.from(String(atom));
    case 'list':
      return copy(atom);
    }

    throw err("{_PROC_}: Expected list");
  }

  // 'stringify if word'
  // Takes an atom which is to be the subject of lexpr() and a result
  // list. If the atom is a word, returns a word, otherwise a list.
  function sifw(atom, list) {
    return (Type(atom) === 'word') ? list.join('') : list;
  }

  //----------------------------------------------------------------------
  // Returns a deep copy of a value (word or list). Arrays are copied
  // by reference.
  //----------------------------------------------------------------------
  function copy(value) {
    switch (Type(value)) {
    case 'list': return value.map(copy);
    default: return value;
    }
  }

  //----------------------------------------------------------------------
  // Deep compare of values (numbers, strings, lists)
  //----------------------------------------------------------------------
  function equal(a, b) {
    if (Type(a) !== Type(b)) return false;
    switch (Type(a)) {
    case 'word':
      if (typeof a === 'number' || typeof b === 'number')
        return Number(a) === Number(b);
      else
        return String(a) === String(b);
    case 'list':
      if (a.length !== b.length)
        return false;
      for (var i = 0; i < a.length; i += 1) {
        if (!equal(a[i], b[i]))
          return false;
      }
      return true;
    case 'array':
      return a === b;
    }
    return undefined;
  }

  //----------------------------------------------------------------------
  //
  // Execute a script
  //
  //----------------------------------------------------------------------

  //----------------------------------------------------------------------
  // Execute a sequence of statements
  //----------------------------------------------------------------------
  self.execute = function(statements, options) {
    options = Object(options);
    // Operate on a copy so the original is not destroyed
    statements = statements.slice();

    var lastResult;
    return promiseLoop(function(loop, resolve, reject) {
      if (self.forceBye) {
        self.forceBye = false;
        reject(new Bye);
        return;
      }
      if (!statements.length) {
        resolve(lastResult);
        return;
      }
      Promise.resolve(evaluateExpression(statements))
        .then(function(result) {
          if (result !== undefined && !options.returnResult) {
            reject(err("Don't know what to do with {result}", {result: result}));
            return;
          }
          lastResult = result;
          loop();
        }, reject);
    });
  };

  // FIXME: should this confirm that something is running?
  self.bye = function() {
    self.forceBye = true;
  };

  var lastRun = Promise.resolve();

  // Call to insert an arbitrary task (callback) to be run in sequence
  // with pending calls to run. Useful in tests to do work just before
  // a subsequent assertion.
  self.queueTask = function(task) {
    var promise = lastRun.then(function() {
      return Promise.resolve(task());
    });
    lastRun = promise.catch(function(){});
    return promise;
  };

  self.run = function(string, options) {
    options = Object(options);
    return self.queueTask(function() {
      // Parse it
      var atoms = parse(string);

      // And execute it!
      return self.execute(atoms, options)
        .catch(function(err) {
          if (!(err instanceof Bye))
            throw err;
        });
    });
  };

  self.definition = function(name, proc) {

    function defn(atom) {
      switch (Type(atom)) {
      case 'word': return String(atom);
      case 'list': return '[ ' + atom.map(defn).join(' ') + ' ]';
      case 'array': return '{ ' + atom.list().map(defn).join(' ') + ' }' +
          (atom.origin === 1 ? '' : '@' + atom.origin);
      default: throw new Error("Internal error: unknown type");
      }
    }

    var def = "to " + name;
    if (proc.inputs.length) {
      def += " ";
      def += proc.inputs.map(function(a) { return ":" + a; }).join(" ");
    }
    def += "\n";
    def += "  " + proc.block.map(defn).join(" ").replace(new RegExp(UNARY_MINUS + ' ', 'g'), '-');
    def += "\n" + "end";

    return def;
  };

  // API to allow pages to persist definitions
  self.procdefs = function() {
    var defs = [];
    self.routines.forEach(function(name, proc) {
      if (!proc.primitive) {
        defs.push(self.definition(name, proc));
      }
    });
    return defs.join("\n\n");
  };

  // API to allow aliasing. Can be used for localization. Does not
  // check for errors.
  self.copydef = function(newname, oldname) {
    self.routines.set(newname, self.routines.get(oldname));
  };

  //----------------------------------------------------------------------
  //
  // Built-In Proceedures
  //
  //----------------------------------------------------------------------

  // Basic form:
  //
  //  def("procname", function(input1, input2, ...) { ... return output; });
  //   * inputs are JavaScript strings, numbers, or Arrays
  //   * output is string, number, Array or undefined/no output
  //
  // Special forms:
  //
  //  def("procname", function(tokenlist) { ... }, {special: true});
  //   * input is Array (list) of tokens (words, numbers, Arrays)
  //   * used for implementation of special forms (e.g. TO inputs... statements... END)
  //
  //  def("procname", function(fin, fin, ...) { ... return op; }, {noeval: true});
  //   * inputs are arity-0 functions that evaluate to string, number Array
  //   * used for short-circuiting evaluation (AND, OR)
  //   * used for repeat evaluation (DO.WHILE, WHILE, DO.UNTIL, UNTIL)
  //

  function stringify(thing) {
    switch (Type(thing)) {
    case 'list':
      return "[" + thing.map(stringify).join(" ") + "]";
    case 'array':
      return "{" + thing.list().map(stringify).join(" ") + "}" +
        (thing.origin === 1 ? '' : '@' + thing.origin);
    default:
      return sexpr(thing);
    }
  }

  function stringify_nodecorate(thing) {
    switch (Type(thing)) {
    case 'list':
      return thing.map(stringify).join(" ");
    case 'array':
      return thing.list().map(stringify).join(" ");
    default:
      return sexpr(thing);
    }
  }

  function def(name, fn, props) {
    if (props) {
      Object.keys(props).forEach(function(key) {
        fn[key] = props[key];
      });
    }
    fn.primitive = true;
    if (Array.isArray(name)) {
      name.forEach(function(name) {
        self.routines.set(name, fn);
      });
    } else {
      self.routines.set(name, fn);
    }
  }

  //
  // Procedures and Flow Control
  //
  def("to", function(list) {
    var name = sexpr(list.shift());
    if (isNumber(name) || isOperator(name))
      throw err("TO: Expected identifier");

    var inputs = [];
    var block = [];

    // Process inputs, then the statements of the block
    var state_inputs = true, sawEnd = false;
    while (list.length) {
      var atom = list.shift();
      if (isKeyword(atom, 'END')) {
        sawEnd = true;
        break;
      } else if (state_inputs && Type(atom) === 'word' && String(atom).charAt(0) === ':') {
        inputs.push(atom.substring(1));
      } else {
        state_inputs = false;
        block.push(atom);
      }
    }
    if (!sawEnd)
      throw err("TO: Expected END");

    defineProc(name, inputs, block);
  }, {special: true});

  function defineProc(name, inputs, block) {
    if (self.routines.has(name) && self.routines.get(name).primitive) {
      throw err("{_PROC_}: Can't redefine primitive {name:U}", { name: name });
    }

    // Closure over inputs and block to handle scopes, arguments and outputs
    var func = function() {

      // Define a new scope
      var scope = new StringMap(true);
      for (var i = 0; i < inputs.length && i < arguments.length; i += 1) {
        scope.set(inputs[i], {value: arguments[i]});
      }
      self.scopes.push(scope);
      return promiseFinally(self.execute(block).then(promiseYield, function(err) {
        if (err instanceof Output)
          return err.output;
        throw err;
      }), function() {
        self.scopes.pop();
      });
    };

    var proc = to_arity(func, inputs.length);
    self.routines.set(name, proc);

    // For DEF de-serialization
    proc.inputs = inputs;
    proc.block = block;

    if (savehook)
      savehook(name, self.definition(name, proc));
  }


  def("def", function(list) {

    var name = sexpr(list);
    var proc = self.routines.get(name);
    if (!proc)
      throw err("{_PROC_}: Don't know how to {name:U}", { name: name });
    if (!proc.inputs)
      throw err("{_PROC_}: Can't show definition of primitive {name:U}", { name: name });

    return self.definition(name, proc);
  });


  //----------------------------------------------------------------------
  //
  // 2. Data Structure Primitives
  //
  //----------------------------------------------------------------------

  //
  // 2.1 Constructors
  //

  def("word", function(word1, word2) {
    return arguments.length ?
      Array.from(arguments).map(sexpr).reduce(function(a, b) { return a + b; }) : "";
  });

  def("list", function(thing1, thing2) {
    return Array.from(arguments).map(function(x) { return x; }); // Make a copy
  });

  def(["sentence", "se"], function(thing1, thing2) {
    var list = [];
    for (var i = 0; i < arguments.length; i += 1) {
      var thing = arguments[i];
      if (Type(thing) === 'list') {
        thing = lexpr(thing);
        list = list.concat(thing);
      } else {
        list.push(thing);
      }
    }
    return list;
  });

  def("fput", function(thing, list) {
    var l = lexpr(list); l.unshift(thing); return sifw(list, l);
  });

  def("lput", function(thing, list) {
    var l = lexpr(list); l.push(thing); return sifw(list, l);
  });

  def("array", function(size) {
    size = aexpr(size);
    if (size < 1)
      throw err("{_PROC_}: Array size must be positive integer");
    var origin = (arguments.length < 2) ? 1 : aexpr(arguments[1]);
    return new LogoArray(size, origin);
  });

  def("mdarray", function(sizes) {
    sizes = lexpr(sizes).map(aexpr).map(function(n) { return n|0; });
    if (sizes.some(function(size) { return size < 1; }))
      throw err("{_PROC_}: Array size must be positive integer");
    var origin = (arguments.length < 2) ? 1 : aexpr(arguments[1]);

    function make(index) {
      var n = sizes[index], a = new LogoArray(n, origin);
      if (index + 1 < sizes.length) {
        for (var i = 0; i < n; ++i)
          a.setItem(i + origin, make(index + 1));
      }
      return a;
    }

    return make(0);
  });

  def("listtoarray", function(list) {
    list = lexpr(list);
    var origin = 1;
    if (arguments.length > 1)
      origin = aexpr(arguments[1]);
    return LogoArray.from(list, origin);
  });

  def("arraytolist", function(array) {
    if (Type(array) !== 'array') {
      throw err("{_PROC_}: Expected array");
    }
    return array.list().slice();
  });

  def("combine", function(thing1, thing2) {
    if (Type(thing2) !== 'list') {
      return self.routines.get('word')(thing1, thing2);
    } else {
      return self.routines.get('fput')(thing1, thing2);
    }
  });

  def("reverse", function(list) {
    return sifw(list, lexpr(list).reverse());
  });

  var gensym_index = 0;
  def("gensym", function() {
    gensym_index += 1;
    return 'G' + gensym_index;
  });

  //
  // 2.2 Data Selectors
  //

  def("first", function(list) { return lexpr(list)[0]; });

  def("firsts", function(list) {
    return lexpr(list).map(function(x) { return x[0]; });
  });

  def("last", function(list) { list = lexpr(list); return list[list.length - 1]; });

  def(["butfirst", "bf"], function(list) {
    return sifw(list, lexpr(list).slice(1));
  });

  def(["butfirsts", "bfs"], function(list) {
    return lexpr(list).map(function(x) { return sifw(x, lexpr(x).slice(1)); });
  });

  def(["butlast", "bl"], function(list) {
    return Type(list) === 'word' ? String(list).slice(0, -1) : lexpr(list).slice(0, -1);
  });

  function item(index, thing) {
    switch (Type(thing)) {
    case 'list':
      if (index < 1 || index > thing.length)
        throw err("{_PROC_}: Index out of bounds");
      return thing[index - 1];
    case 'array':
      return thing.item(index);
    default:
      thing = sexpr(thing);
      if (index < 1 || index > thing.length)
        throw err("{_PROC_}: Index out of bounds");
      return thing.charAt(index - 1);
    }
  }

  def("item", function(index, thing) {
    index = aexpr(index)|0;
    return item(index, thing);
  });

  def("mditem", function(indexes, thing) {
    indexes = lexpr(indexes).map(aexpr).map(function(n) { return n|0; });
    while (indexes.length)
      thing = item(indexes.shift(), thing);
    return thing;
  });

  def("pick", function(list) {
    list = lexpr(list);
    var i = Math.floor(self.prng.next() * list.length);
    return list[i];
  });

  def("remove", function(thing, list) {
    return sifw(list, lexpr(list).filter(function(x) { return !equal(x, thing); }));
  });

  def("remdup", function(list) {
    // TODO: This only works with JS equality. Use equalp.
    var set = new Set();
    return sifw(list, lexpr(list).filter(function(x) {
      if (set.has(x)) { return false; } else { set.add(x); return true; }
    }));
  });

  def("split", function(thing, list) {
    var l = lexpr(list);
    return lexpr(list)
      .reduce(function(ls, i) {
        return (equal(i, thing) ? ls.push([]) : ls[ls.length - 1].push(i), ls);
      }, [[]])
      .filter(function(l) { return l.length > 0; })
      .map(function(e) { return sifw(list, e); });
  });

  // Not Supported: quoted

  //
  // 2.3 Data Mutators
  //

  function contains(atom, value) {
    if (atom === value) return true;
    switch (Type(atom)) {
    case 'list':
      return atom.some(function(a) { return contains(a, value); });
    case 'array':
      return atom.list().some(function(a) { return contains(a, value); });
    default:
      return false;
    }
  }

  def("setitem", function(index, array, value) {
    index = aexpr(index);
    if (Type(array) !== 'array')
      throw err("{_PROC_}: Expected array");
    if (contains(value, array))
      throw err("{_PROC_}: Can't create circular array");
    array.setItem(index, value);
  });

  def("mdsetitem", function(indexes, thing, value) {
    indexes = lexpr(indexes).map(aexpr).map(function(n) { return n|0; });
    if (Type(thing) !== 'array')
      throw err("{_PROC_}: Expected array");
    if (contains(value, thing))
      throw err("{_PROC_}: Can't create circular array");
    while (indexes.length > 1) {
      thing = item(indexes.shift(), thing);
      if (Type(thing) !== 'array')
        throw err("{_PROC_}: Expected array");
    }
    thing.setItem(indexes.shift(), value);
  });

  def(".setfirst", function(list, value) {
     if (Type(list) !== 'list')
      throw err("{_PROC_}: Expected list");
    list[0] = value;
  });

  def(".setbf", function(list, value) {
    if (Type(list) !== 'list')
      throw err("{_PROC_}: Expected non-empty list");
    if (list.length < 1)
      throw err("{_PROC_}: Expected non-empty list");
    value = lexpr(value);
    list.length = 1;
    list.push.apply(list, value);
  });

  def(".setitem", function(index, array, value) {
    index = aexpr(index);
    if (Type(array) !== 'array')
      throw err("{_PROC_}: Expected array");
    array.setItem(index, value);
  });

  def("push", function(stackname, thing) {
    var got = getvar(stackname);
    var stack = lexpr(got);
    stack.unshift(thing);
    setvar(stackname, sifw(got, stack));
  });

  def("pop", function(stackname) {
    var got = getvar(stackname);
    var stack = lexpr(got);
    var atom = stack.shift();
    setvar(stackname, sifw(got, stack));
    return atom;
  });

  def("queue", function(stackname, thing) {
    var got = getvar(stackname);
    var queue = lexpr(got);
    queue.push(thing);
    setvar(stackname, sifw(got, queue));
  });

  def("dequeue", function(stackname) {
    var got = getvar(stackname);
    var queue = lexpr(got);
    var atom = queue.pop();
    setvar(stackname, sifw(got, queue));
    return atom;
  });


  //
  // 2.4 Predicates
  //

  def(["wordp", "word?"], function(thing) { return Type(thing) === 'word' ? 1 : 0; });
  def(["listp", "list?"], function(thing) { return Type(thing) === 'list' ? 1 : 0; });
  def(["arrayp", "array?"], function(thing) { return Type(thing) === 'array' ? 1 : 0; });
  def(["numberp", "number?"], function(thing) {
    return Type(thing) === 'word' && isNumber(thing) ? 1 : 0;
  });
  def(["numberwang"], function(thing) { return self.prng.next() < 0.5 ? 1 : 0; });

  def(["equalp", "equal?"], function(a, b) { return equal(a, b) ? 1 : 0; });
  def(["notequalp", "notequal?"], function(a, b) { return !equal(a, b) ? 1 : 0; });

  def(["emptyp", "empty?"], function(thing) {
    switch (Type(thing)) {
    case 'word': return String(thing).length === 0 ? 1 : 0;
    case 'list': return thing.length === 0 ? 1 : 0;
    default: return 0;
    }
  });
  def(["beforep", "before?"], function(word1, word2) {
    return sexpr(word1) < sexpr(word2) ? 1 : 0;
  });

  def(".eq", function(a, b) { return a === b && a && typeof a === 'object'; });

  // Not Supported: vbarredp

  def(["memberp", "member?"], function(thing, list) {
    return lexpr(list).some(function(x) { return equal(x, thing); }) ? 1 : 0;
  });


  def(["substringp", "substring?"], function(word1, word2) {
    return sexpr(word2).indexOf(sexpr(word1)) !== -1 ? 1 : 0;
  });

  //
  // 2.5 Queries
  //

  def("count", function(thing) {
    if (Type(thing) === 'array')
      return thing.count();
    return lexpr(thing).length;
  });
  def("ascii", function(chr) { return sexpr(chr).charCodeAt(0); });
  // Not Supported: rawascii
  def("char", function(integer) { return String.fromCharCode(aexpr(integer)); });

  def("member", function(thing, input) {
    var list = lexpr(input);
    var index = list.findIndex(function(x) { return equal(x, thing); });
    list = (index === -1) ? [] : list.slice(index);
    return sifw(input, list);
 });

  def("lowercase", function(word) { return sexpr(word).toLowerCase(); });
  def("uppercase", function(word) { return sexpr(word).toUpperCase(); });

  def("standout", function(word) {
    // Hack: Convert English alphanumerics to Mathematical Bold
    return sexpr(word)
      .split('')
      .map(function(c) {
        var u = c.charCodeAt(0);
        if ('A' <= c && c <= 'Z') {
          u = u - 0x41 + 0x1D400;
        } else if ('a' <= c && c <= 'z') {
          u = u - 0x61 + 0x1D41A;
        } else if ('0' <= c && c <= '9') {
          u = u - 0x30 + 0x1D7CE;
        } else {
          return c;
        }
        var lead = ((u - 0x10000) >> 10) + 0xD800;
        var trail = ((u - 0x10000) & 0x3FF) + 0xDC00;
        return String.fromCharCode(lead, trail);
      })
      .join('');
  });

  // Not Supported: parse
  // Not Supported: runparse

  //----------------------------------------------------------------------
  //
  // 3. Communication
  //
  //----------------------------------------------------------------------

  // 3.1 Transmitters

  def(["print", "pr"], function(thing) {
    var s = Array.from(arguments).map(stringify_nodecorate).join(" ");
    self.stream.write(s, "\n");
  });
  def("type", function(thing) {
    var s = Array.from(arguments).map(stringify_nodecorate).join("");
    self.stream.write(s);
  });
  def("show", function(thing) {
    var s = Array.from(arguments).map(stringify).join(" ");
    self.stream.write(s, "\n");
  });

  // 3.2 Receivers

  // Not Supported: readlist

  def("readword", function() {
    if (arguments.length > 0)
      return stream.read(stringify_nodecorate(arguments[0]));
    else
      return stream.read();
  });


  // Not Supported: readrawline
  // Not Supported: readchar
  // Not Supported: readchars
  // Not Supported: shell

  // 3.3 File Access

  // Not Supported: setprefix
  // Not Supported: prefix
  // Not Supported: openread
  // Not Supported: openwrite
  // Not Supported: openappend
  // Not Supported: openupdate
  // Not Supported: close
  // Not Supported: allopen
  // Not Supported: closeall
  // Not Supported: erasefile
  // Not Supported: dribble
  // Not Supported: nodribble
  // Not Supported: setread
  // Not Supported: setwrite
  // Not Supported: reader
  // Not Supported: writer
  // Not Supported: setreadpos
  // Not Supported: setwritepos
  // Not Supported: readpos
  // Not Supported: writepos
  // Not Supported: eofp
  // Not Supported: filep

  // 3.4 Terminal Access

  // Not Supported: keyp

  def(["cleartext", "ct"], function() {
    self.stream.clear();
  });

  // Not Supported: setcursor
  // Not Supported: cursor
  // Not Supported: setmargins
  // Not Supported: settextcolor
  // Not Supported: increasefont
  // Not Supported: settextsize
  // Not Supported: textsize
  // Not Supported: setfont
  // Not Supported: font

  //----------------------------------------------------------------------
  //
  // 4. Arithmetic
  //
  //----------------------------------------------------------------------
  // 4.1 Numeric Operations


  def("sum", function(a, b) {
    return Array.from(arguments).map(aexpr).reduce(function(a, b) { return a + b; }, 0);
  });

  def("difference", function(a, b) {
    return aexpr(a) - aexpr(b);
  });

  def("minus", function(a) { return -aexpr(a); });

  def("product", function(a, b) {
    return Array.from(arguments).map(aexpr).reduce(function(a, b) { return a * b; }, 1);
  });

  def("quotient", function(a, b) {
    if (b !== undefined)
      return aexpr(a) / aexpr(b);
    else
      return 1 / aexpr(a);
  });

  def("remainder", function(num1, num2) {
    return aexpr(num1) % aexpr(num2);
  });
  def("modulo", function(num1, num2) {
    num1 = aexpr(num1);
    num2 = aexpr(num2);
    return Math.abs(num1 % num2) * (num2 < 0 ? -1 : 1);
  });

  def("power", function(a, b) { return Math.pow(aexpr(a), aexpr(b)); });
  def("sqrt", function(a) { return Math.sqrt(aexpr(a)); });
  def("exp", function(a) { return Math.exp(aexpr(a)); });
  def("log10", function(a) { return Math.log(aexpr(a)) / Math.LN10; });
  def("ln", function(a) { return Math.log(aexpr(a)); });


  function deg2rad(d) { return d / 180 * Math.PI; }
  function rad2deg(r) { return r * 180 / Math.PI; }

  def("arctan", function(a) {
    if (arguments.length > 1) {
      var x = aexpr(arguments[0]);
      var y = aexpr(arguments[1]);
      return rad2deg(Math.atan2(y, x));
    } else {
      return rad2deg(Math.atan(aexpr(a)));
    }
  });

  def("sin", function(a) { return Math.sin(deg2rad(aexpr(a))); });
  def("cos", function(a) { return Math.cos(deg2rad(aexpr(a))); });
  def("tan", function(a) { return Math.tan(deg2rad(aexpr(a))); });

  def("radarctan", function(a) {
    if (arguments.length > 1) {
      var x = aexpr(arguments[0]);
      var y = aexpr(arguments[1]);
      return Math.atan2(y, x);
    } else {
      return Math.atan(aexpr(a));
    }
  });

  def("radsin", function(a) { return Math.sin(aexpr(a)); });
  def("radcos", function(a) { return Math.cos(aexpr(a)); });
  def("radtan", function(a) { return Math.tan(aexpr(a)); });

  def("abs", function(a) { return Math.abs(aexpr(a)); });


  function truncate(x) { return parseInt(x, 10); }

  def("int", function(a) { return truncate(aexpr(a)); });
  def("round", function(a) { return Math.round(aexpr(a)); });

  def("iseq", function(a, b) {
    a = truncate(aexpr(a));
    b = truncate(aexpr(b));
    var step = (a < b) ? 1 : -1;
    var list = [];
    for (var i = a; (step > 0) ? (i <= b) : (i >= b); i += step) {
      list.push(i);
    }
    return list;
  });


  def("rseq", function(from, to, count) {
    from = aexpr(from);
    to = aexpr(to);
    count = truncate(aexpr(count));
    var step = (to - from) / (count - 1);
    var list = [];
    for (var i = from; (step > 0) ? (i <= to) : (i >= to); i += step) {
      list.push(i);
    }
    return list;
  });

  // 4.2 Numeric Predicates

  def(["greaterp", "greater?"], function(a, b) { return aexpr(a) > aexpr(b) ? 1 : 0; });
  def(["greaterequalp", "greaterequal?"], function(a, b) { return aexpr(a) >= aexpr(b) ? 1 : 0; });
  def(["lessp", "less?"], function(a, b) { return aexpr(a) < aexpr(b) ? 1 : 0; });
  def(["lessequalp", "lessequal?"], function(a, b) { return aexpr(a) <= aexpr(b) ? 1 : 0; });

  // 4.3 Random Numbers

  def("random", function(max) {
    max = aexpr(max);
    return Math.floor(self.prng.next() * max);
  });

  def("rerandom", function() {
    var seed = (arguments.length > 0) ? aexpr(arguments[0]) : 2345678901;
    return self.prng.seed(seed);
  });

  // 4.4 Print Formatting

  def("form", function(num, width, precision) {
    num = aexpr(num);
    width = aexpr(width);
    precision = aexpr(precision);

    var str = num.toFixed(precision);
    if (str.length < width)
      str = Array(1 + width - str.length).join(' ') + str;
    return str;
  });

  // 4.5 Bitwise Operations


  def("bitand", function(num1, num2) {
    return Array.from(arguments).map(aexpr).reduce(function(a, b) { return a & b; }, -1);
  });
  def("bitor", function(num1, num2) {
    return Array.from(arguments).map(aexpr).reduce(function(a, b) { return a | b; }, 0);
  });
  def("bitxor", function(num1, num2) {
    return Array.from(arguments).map(aexpr).reduce(function(a, b) { return a ^ b; }, 0);
  });
  def("bitnot", function(num) {
    return ~aexpr(num);
  });


  def("ashift", function(num1, num2) {
    num1 = truncate(aexpr(num1));
    num2 = truncate(aexpr(num2));
    return num2 >= 0 ? num1 << num2 : num1 >> -num2;
  });

  def("lshift", function(num1, num2) {
    num1 = truncate(aexpr(num1));
    num2 = truncate(aexpr(num2));
    return num2 >= 0 ? num1 << num2 : num1 >>> -num2;
  });


  //----------------------------------------------------------------------
  //
  // 5. Logical Operations
  //
  //----------------------------------------------------------------------

  def("true", function() { return 1; });
  def("false", function() { return 0; });

  def("and", function(a, b) {
    var args = Array.from(arguments);
    return booleanReduce(args, function(value) {return value;}, 1);
  }, {noeval: true});

  def("or", function(a, b) {
    var args = Array.from(arguments);
    return booleanReduce(args, function(value) {return !value;}, 0);
  }, {noeval: true});

  function booleanReduce(args, test, value) {
    return promiseLoop(function(loop, resolve, reject) {
      if (!args.length) {
        resolve(value);
        return;
      }
      Promise.resolve(args.shift()())
        .then(function(result) {
          if (!test(result)) {
            resolve(result);
            return;
          }
          value = result;
          loop();
        });
    });
  }

  def("xor", function(a, b) {
    return Array.from(arguments).map(aexpr)
      .reduce(function(a, b) { return Boolean(a) !== Boolean(b); }, 0) ? 1 : 0;
  });

  def("not", function(a) {
    return !aexpr(a) ? 1 : 0;
  });

  //----------------------------------------------------------------------
  //
  // 6. Graphics
  //
  //----------------------------------------------------------------------
  // 6.1 Turtle Motion

  def(["forward", "fd"], function(a) { return turtle.move(aexpr(a)); });
  def(["back", "bk"], function(a) { return turtle.move(-aexpr(a)); });
  def(["left", "lt"], function(a) { return turtle.turn(-aexpr(a)); });
  def(["right", "rt"], function(a) { return turtle.turn(aexpr(a)); });

  // Left arrow:
  def(["\u2190"], function() { return turtle.turn(-15); });
  // Right arrow:
  def(["\u2192"], function() { return turtle.turn(15); });
  // Up arrow:
  def(["\u2191"], function() { return turtle.move(10); });
  // Down arrow:
  def(["\u2193"], function() { return turtle.move(-10); });


  def("setpos", function(l) {
    l = lexpr(l);
    if (l.length !== 2) throw err("{_PROC_}: Expected list of length 2");
    return turtle.setposition(aexpr(l[0]), aexpr(l[1]));
  });
  def("setxy", function(x, y) { return turtle.setposition(aexpr(x), aexpr(y)); });
  def("setx", function(x) { return turtle.setposition(aexpr(x), undefined); }); // TODO: Replace with ...?
  def("sety", function(y) { return turtle.setposition(undefined, aexpr(y)); });
  def(["setheading", "seth"], function(a) { return turtle.setheading(aexpr(a)); });

  def("home", function() { return turtle.home(); });

  def("arc", function(angle, radius) { return turtle.arc(aexpr(angle), aexpr(radius)); });

  //
  // 6.2 Turtle Motion Queries
  //

  def("pos", function() { var l = turtle.getxy(); return [l[0], l[1]]; });
  def("xcor", function() { var l = turtle.getxy(); return l[0]; });
  def("ycor", function() { var l = turtle.getxy(); return l[1]; });
  def("heading", function() { return turtle.getheading(); });
  def("towards", function(l) {
    l = lexpr(l);
    if (l.length !== 2) throw err("{_PROC_}: Expected list of length 2");
    return turtle.towards(aexpr(l[0]), aexpr(l[1]));
  });
  def("scrunch", function() { return turtle.getscrunch(); });

  //
  // 6.3 Turtle and Window Control
  //

  def(["showturtle", "st"], function() { return turtle.showturtle(); });
  def(["hideturtle", "ht"], function() { return turtle.hideturtle(); });
  def("clean", function() { return turtle.clear(); });
  def(["clearscreen", "cs"], function() { return turtle.clearscreen(); });

  def("wrap", function() { return turtle.setturtlemode('wrap'); });
  def("window", function() { return turtle.setturtlemode('window'); });
  def("fence", function() { return turtle.setturtlemode('fence'); });

  def("fill", function() { return turtle.fill(); });

  def("filled", function(fillcolor, statements) {
    fillcolor = sexpr(fillcolor);
    statements = reparse(lexpr(statements));
    turtle.beginpath();
    return promiseFinally(
      self.execute(statements),
      function() {
        turtle.fillpath(fillcolor);
      });
  });

  def("label", function(a) {
    var s = Array.from(arguments).map(stringify_nodecorate).join(" ");
    return turtle.drawtext(s);
  });

  def("setlabelheight", function(a) { return turtle.setfontsize(aexpr(a)); });

  def("setlabelfont", function(a) { return turtle.setfontname(sexpr(a)); });

  // Not Supported: textscreen
  // Not Supported: fullscreen
  // Not Supported: splitscreen

  def("setscrunch", function(sx, sy) {
    sx = aexpr(sx);
    sy = aexpr(sy);
    if (!isFinite(sx) || sx === 0 || !isFinite(sy) || sy === 0)
      throw err("{_PROC_}: Expected non-zero values");
    return turtle.setscrunch(sx, sy);
  });

  // Not Supported: refresh
  // Not Supported: norefresh

  //
  // 6.4 Turtle and Window Queries
  //

  def(["shownp", "shown?"], function() {
    return turtle.isturtlevisible() ? 1 : 0;
  });

  // Not Supported: screenmode

  def("turtlemode", function() {
    return turtle.getturtlemode().toUpperCase();
  });

  def("labelsize", function() {
    return [turtle.getfontsize(), turtle.getfontsize()];
  });

  def("labelfont", function() {
    return turtle.getfontname();
  });

  //
  // 6.5 Pen and Background Control
  //
  def(["pendown", "pd"], function() { return turtle.pendown(); });
  def(["penup", "pu"], function() { return turtle.penup(); });

  def(["penpaint", "ppt"], function() { return turtle.setpenmode('paint'); });
  def(["penerase", "pe"], function() { return turtle.setpenmode('erase'); });
  def(["penreverse", "px"], function() { return turtle.setpenmode('reverse'); });

  function parseColor(color) {
    function adjust(n) {
      // Clamp into 0...99
      n = Math.min(99, Math.max(0, Math.floor(n)));
      // Scale to 0...255
      return Math.floor(n * 255 / 99);
    }
    if (Type(color) === 'list') {
      var r = adjust(aexpr(color[0]));
      var g = adjust(aexpr(color[1]));
      var b = adjust(aexpr(color[2]));
      var rr = (r < 16 ? "0" : "") + r.toString(16);
      var gg = (g < 16 ? "0" : "") + g.toString(16);
      var bb = (b < 16 ? "0" : "") + b.toString(16);
      return '#' + rr + gg + bb;
    }
    return sexpr(color);
  }

  def(["setpencolor", "setpc", "setcolor"], function(color) {
    turtle.setcolor(parseColor(color));
  });

  // Not Supported: setpalette

  def(["setpensize", "setwidth", "setpw"], function(a) {
    if (Type(a) === 'list')
      return turtle.setwidth(aexpr(a[0]));
    else
      return turtle.setwidth(aexpr(a));
  });

  // Not Supported: setpenpattern
  // Not Supported: setpen

  def(["setbackground", "setscreencolor", "setsc"], function(color) {
    turtle.setbgcolor(parseColor(color));
  });

  //
  // 6.6 Pen Queries
  //

  def(["pendownp", "pendown?"], function() {
    return turtle.ispendown() ? 1 : 0;
  });

  def("penmode", function() {
    return turtle.getpenmode().toUpperCase();
  });

  def(["pencolor", "pc"], function() {
    return turtle.getcolor();
  });

  // Not Supported: palette

  def("pensize", function() {
    return [turtle.getwidth(), turtle.getwidth()];
  });

  // Not Supported: pen

  def(["background", "getscreencolor", "getsc"], function() {
    return turtle.getbgcolor();
  });

  // 6.7 Saving and Loading Pictures

  // Not Supported: savepict
  // Not Supported: loadpict
  // Not Supported: epspict

  // 6.8 Mouse Queries

  // Not Supported: mousepos
  // Not Supported: clickpos
  // Not Supported: buttonp
  // Not Supported: button

  //----------------------------------------------------------------------
  //
  // 7. Workspace Management
  //
  //----------------------------------------------------------------------
  // 7.1 Procedure Definition

  def("define", function(name, list) {
    name = sexpr(name);
    list = lexpr(list);
    if (list.length != 2)
      throw err("{_PROC_}: Expected list of length 2");

    var inputs = lexpr(list[0]);
    var block = reparse(lexpr(list[1]));
    defineProc(name, inputs, block);
  });

  def("text", function(name) {
    var proc = self.routines.get(sexpr(name));
    if (!proc)
      throw err("{_PROC_}: Don't know how to {name:U}", { name: name });
    if (!proc.inputs)
      throw err("{_PROC_}: Can't show definition of primitive {name:U}", { name: name });

    return [proc.inputs, proc.block];
  });

  // Not Supported: fulltext

  def("copydef", function(newname, oldname) {

    newname = sexpr(newname);
    oldname = sexpr(oldname);

    if (!self.routines.has(oldname)) {
      throw err("{_PROC_}: Don't know how to {name:U}", { name: oldname });
    }

    if (self.routines.has(newname)) {
      if (self.routines.get(newname).special) {
        throw err("{_PROC_}: Can't overwrite special {name:U}", { name: newname });
      }
      if (self.routines.get(newname).primitive && !maybegetvar("redefp")) {
        throw err("{_PROC_}: Can't overwrite primitives unless REDEFP is TRUE");
      }
    }

    self.routines.set(newname, self.routines.get(oldname));
    if (savehook) {
      // TODO: This is broken if copying a built-in, so disable for now
      //savehook(newname, self.definition(newname, self.routines.get(newname)));
    }
  });


  // 7.2 Variable Definition

  def("make", function(varname, value) {
    setvar(sexpr(varname), value);
  });

  def("name", function(value, varname) {
    setvar(sexpr(varname), value);
  });

  def("local", function(varname) {
    var localscope = self.scopes[self.scopes.length - 1];
    Array.from(arguments).forEach(function(name) { localscope.set(sexpr(name), {value: undefined}); });
  });

  def("localmake", function(varname, value) {
    var localscope = self.scopes[self.scopes.length - 1];
    localscope.set(sexpr(varname), {value: value});
  });

  def("thing", function(varname) {
    return getvar(sexpr(varname));
  });

  def("global", function(varname) {
    var globalscope = self.scopes[0];
    Array.from(arguments).forEach(function(name) {
      globalscope.set(sexpr(name), {value: undefined}); });
  });

  //
  // 7.3 Property Lists
  //

  def("pprop", function(plistname, propname, value) {
    plistname = sexpr(plistname);
    propname = sexpr(propname);
    var plist = self.plists.get(plistname);
    if (!plist) {
      plist = new StringMap(true);
      self.plists.set(plistname, plist);
    }
    plist.set(propname, value);
  });

  def("gprop", function(plistname, propname) {
    plistname = sexpr(plistname);
    propname = sexpr(propname);
    var plist = self.plists.get(plistname);
    if (!plist || !plist.has(propname))
      return [];
    return plist.get(propname);
  });

  def("remprop", function(plistname, propname) {
    plistname = sexpr(plistname);
    propname = sexpr(propname);
    var plist = self.plists.get(plistname);
    if (plist) {
      plist['delete'](propname);
      if (plist.empty()) {
        // TODO: Do this? Loses state, e.g. unburies if buried
        self.plists['delete'](plistname);
      }
    }
  });

  def("plist", function(plistname) {
    plistname = sexpr(plistname);
    var plist = self.plists.get(plistname);
    if (!plist)
      return [];

    var result = [];
    plist.forEach(function(key, value) {
      result.push(key);
      result.push(copy(value));
    });
    return result;
  });

  //
  // 7.4 Workspace Predicates
  //

  def(["procedurep", "procedure?"], function(name) {
    name = sexpr(name);
    return self.routines.has(name) ? 1 : 0;
  });

  def(["primitivep", "primitive?"], function(name) {
    name = sexpr(name);
    return (self.routines.has(name) &&
            self.routines.get(name).primitive) ? 1 : 0;
  });

  def(["definedp", "defined?"], function(name) {
    name = sexpr(name);
    return (self.routines.has(name) &&
            !self.routines.get(name).primitive) ? 1 : 0;
  });

  def(["namep", "name?"], function(varname) {
    try {
      return getvar(sexpr(varname)) !== undefined ? 1 : 0;
    } catch (e) {
      return 0;
    }
  });

  def(["plistp", "plist?"], function(plistname) {
    plistname = sexpr(plistname);
    return self.plists.has(plistname) ? 1 : 0;
  });

  //
  // 7.5 Workspace Queries
  //

  def("contents", function() {
    return [
      self.routines.keys().filter(function(x) {
        return !self.routines.get(x).primitive && !self.routines.get(x).buried; }),
      self.scopes.reduce(
        function(list, scope) {
          return list.concat(scope.keys().filter(function(x) { return !scope.get(x).buried; })); },
        []),
      self.plists.keys().filter(function(x) { return !self.plists.get(x).buried; })
    ];
  });

  def("buried", function() {
    return [
      self.routines.keys().filter(function(x) {
        return !self.routines.get(x).primitive && self.routines.get(x).buried; }),
      self.scopes.reduce(
        function(list, scope) {
          return list.concat(scope.keys().filter(function(x) { return scope.get(x).buried; })); },
        []),
      self.plists.keys().filter(function(x) { return self.plists.get(x).buried; })
    ];
  });

  def("traced", function() {
    return [
      self.routines.keys().filter(function(x) {
        return !self.routines.get(x).primitive && self.routines.get(x).traced; }),
      self.scopes.reduce(
        function(list, scope) {
          return list.concat(scope.keys().filter(function(x) { return scope.get(x).traced; })); },
        []),
      self.plists.keys().filter(function(x) { return self.plists.get(x).traced; })
    ];
  });

  def(["stepped"], function() {
    return [
      self.routines.keys().filter(function(x) {
        return !self.routines.get(x).primitive && self.routines.get(x).stepped; }),
      self.scopes.reduce(
        function(list, scope) {
          return list.concat(scope.keys().filter(function(x) { return scope.get(x).stepped; })); },
        []),
      self.plists.keys().filter(function(x) { return self.plists.get(x).stepped; })
    ];
  });

  def("procedures", function() {
    return self.routines.keys().filter(function(x) {
      return !self.routines.get(x).primitive && !self.routines.get(x).buried;
    });
  });

  def("primitives", function() {
    return self.routines.keys().filter(function(x) {
      return self.routines.get(x).primitive & !self.routines.get(x).buried;
    });
  });

  def("globals", function() {
    var globalscope = self.scopes[0];
    return globalscope.keys().filter(function(x) {
      return !globalscope.get(x).buried;
    });
  });

  def("names", function() {
    return [
      [],
      self.scopes.reduce(function(list, scope) {
        return list.concat(scope.keys().filter(function(x) {
          return !scope.get(x).buried; })); }, [])
    ];
  });

  def("plists", function() {
    return [
      [],
      [],
      self.plists.keys().filter(function(x) {
        return !self.plists.get(x).buried; })
    ];
  });

  def("namelist", function(varname) {
    if (Type(varname) === 'list')
      varname = lexpr(varname);
    else
      varname = [sexpr(varname)];
    return [[], varname];
  });

  def("pllist", function(plname) {
    if (Type(plname) === 'list') {
      plname = lexpr(plname);
    } else {
      plname = [sexpr(plname)];
    }
    return [[], [], plname];
  });


  // Not Supported: arity
  // Not Supported: nodes

  // 7.6 Workspace Inspection

  //
  // 7.7 Workspace Control
  //

  def("erase", function(list) {
    list = lexpr(list);

    // Delete procedures
    if (list.length) {
      var procs = lexpr(list.shift());
      procs.forEach(function(name) {
        name = sexpr(name);
        if (self.routines.has(name)) {
          if (self.routines.get(name).special)
            throw err("Can't {_PROC_} special {name:U}", { name: name });
          if (!self.routines.get(name).primitive || maybegetvar("redefp")) {
            self.routines['delete'](name);
            if (savehook) savehook(name);
          } else {
            throw err("Can't {_PROC_} primitives unless REDEFP is TRUE");
          }
        }
      });
    }

    // Delete variables
    if (list.length) {
      var vars = lexpr(list.shift());
      // TODO: global only?
      self.scopes.forEach(function(scope) {
        vars.forEach(function(name) {
          name = sexpr(name);
          scope['delete'](name);
        });
      });
    }

    // Delete property lists
    if (list.length) {
      var plists = lexpr(list.shift());
      plists.forEach(function(name) {
        name = sexpr(name);
        self.plists['delete'](name);
      });
    }
  });

  // TODO: lots of redundant logic here -- clean this up
  def("erall", function() {
    self.routines.keys().filter(function(x) {
      return !self.routines.get(x).primitive && !self.routines.get(x).buried;
    }).forEach(function(name) {
      self.routines['delete'](name);
      if (savehook) savehook(name);
    });

    self.scopes.forEach(function(scope) {
      scope.keys().filter(function(x) {
        return !scope.get(x).buried;
      }).forEach(function(name) {
        scope['delete'](name);
      });
    });

    self.plists.keys().filter(function(x) {
      return !self.plists.get(x).buried;
    }).forEach(function(name) {
      self.plists['delete'](name);
    });
  });

  def("erps", function() {
    self.routines.keys().filter(function(x) {
      return !self.routines.get(x).primitive && !self.routines.get(x).buried;
    }).forEach(function(name) {
      self.routines['delete'](name);
      if (savehook) savehook(name);
    });
  });

  def("erns", function() {
    self.scopes.forEach(function(scope) {
      scope.keys().filter(function(x) {
        return !scope.get(x).buried;
      }).forEach(function(name) {
        scope['delete'](name);
      });
    });
  });

  def("erpls", function() {
    self.plists.keys().filter(function(x) {
      return !self.plists.get(x).buried;
    }).forEach(function(key) {
      self.plists['delete'](key);
    });
  });

  def("ern", function(varname) {
    var varnamelist;
    if (Type(varname) === 'list') {
      varnamelist = lexpr(varname);
    } else {
      varnamelist = [sexpr(varname)];
    }

    self.scopes.forEach(function(scope) {
      varnamelist.forEach(function(name) {
        name = sexpr(name);
        scope['delete'](name);
      });
    });
  });

  def("erpl", function(plname) {
    var plnamelist;
    if (Type(plname) === 'list') {
      plnamelist = lexpr(plname);
    } else {
      plnamelist = [sexpr(plname)];
    }

    plnamelist.forEach(function(name) {
      name = sexpr(name);
      self.plists['delete'](name);
    });
  });

  def("bury", function(list) {
    list = lexpr(list);

    // Bury procedures
    if (list.length) {
      var procs = lexpr(list.shift());
      procs.forEach(function(name) {
        name = sexpr(name);
        if (self.routines.has(name))
          self.routines.get(name).buried = true;
      });
    }

    // Bury variables
    if (list.length) {
      var vars = lexpr(list.shift());
      // TODO: global only?
      self.scopes.forEach(function(scope) {
        vars.forEach(function(name) {
          name = sexpr(name);
          if (scope.has(name))
            scope.get(name).buried = true;
        });
      });
    }

    // Bury property lists
    if (list.length) {
      var plists = lexpr(list.shift());
      plists.forEach(function(name) {
        name = sexpr(name);
        if (self.plists.has(name))
          self.plists.get(name).buried = true;
      });
    }
  });

  def("buryall", function() {
    self.routines.forEach(function(name, proc) {
      proc.buried = true;
    });

    self.scopes.forEach(function(scope) {
      scope.forEach(function(name, entry) {
        entry.buried = true;
      });
    });

    self.plists.forEach(function(name, entry) {
      entry.buried = true;
    });
  });

  // Not Supported: buryname

  def("unbury", function(list) {
    list = lexpr(list);

    // Procedures
    if (list.length) {
      var procs = lexpr(list.shift());
      procs.forEach(function(name) {
        name = sexpr(name);
        if (self.routines.has(name))
          self.routines.get(name).buried = false;
      });
    }

    // Variables
    if (list.length) {
      var vars = lexpr(list.shift());
      // TODO: global only?
      self.scopes.forEach(function(scope) {
        vars.forEach(function(name) {
          name = sexpr(name);
          if (scope.has(name))
            scope.get(name).buried = false;
        });
      });
    }

    // Property lists
    if (list.length) {
      var plists = lexpr(list.shift());
      plists.forEach(function(name) {
        name = sexpr(name);
        if (self.plists.has(name))
          self.plists.get(name).buried = false;
      });
    }
  });

  def("unburyall", function() {
    self.routines.forEach(function(name, proc) {
      proc.buried = false;
    });

    self.scopes.forEach(function(scope) {
      scope.forEach(function(name, entry) {
        entry.buried = false;
      });
    });

    self.plists.forEach(function(name, entry) {
      entry.buried = false;
    });
  });

  // Not Supported: unburyname

  def(["buriedp", "buried?"], function(list) {
    list = lexpr(list);
    var name;

    // Procedures
    if (list.length) {
      var procs = lexpr(list.shift());
      if (procs.length) {
        name = sexpr(procs[0]);
        return (self.routines.has(name) && self.routines.get(name).buried) ? 1 : 0;
      }
    }

    // Variables
    if (list.length) {
      var vars = lexpr(list.shift());
      if (vars.length) {
        name = sexpr(vars[0]);
        // TODO: global only?
        return (self.scopes[0].has(name) && self.scopes[0].get(name).buried) ? 1 : 0;
      }
    }

    // Property lists
    if (list.length) {
      var plists = lexpr(list.shift());
      if (plists.length) {
        name = sexpr(plists[0]);
        return (self.plists.has(name) && self.plists.get(name).buried) ? 1 : 0;
      }
    }

    return 0;
  });

  //----------------------------------------------------------------------
  //
  // 8. Control Structures
  //
  //----------------------------------------------------------------------

  //
  // 8.1 Control
  //

  def("run", function(statements) {
    statements = reparse(lexpr(statements));
    return self.execute(statements, {returnResult: true});
  });

  def("runresult", function(statements) {
    statements = reparse(lexpr(statements));
    return self.execute(statements, {returnResult: true})
      .then(function(result) {
        if (result !== undefined)
          return [result];
        else
          return [];
      });
  });

  def("repeat", function(count, statements) {
    count = aexpr(count);
    statements = reparse(lexpr(statements));
    var old_repcount = self.repcount;
    var i = 1;
    return promiseFinally(
      promiseLoop(function(loop, resolve, reject) {
        if (i > count) {
          resolve();
          return;
        }
        self.repcount = i++;
        self.execute(statements)
          .then(promiseYield)
          .then(loop, reject);
      }), function() {
        self.repcount = old_repcount;
      });
  });

  def("forever", function(statements) {
    statements = reparse(lexpr(statements));
    var old_repcount = self.repcount;
    var i = 1;
    return promiseFinally(
      promiseLoop(function(loop, resolve, reject) {
        self.repcount = i++;
        self.execute(statements)
          .then(promiseYield)
          .then(loop, reject);
      }), function() {
        self.repcount = old_repcount;
      });
  });

  def(["repcount", "#"], function() {
    return self.repcount;
  });

  def("if", function(tf, statements) {
    if (Type(tf) === 'list')
      tf = evaluateExpression(reparse(tf));

    return Promise.resolve(tf)
      .then(function(tf) {
        tf = aexpr(tf);
        statements = reparse(lexpr(statements));

        return tf ? self.execute(statements, {returnResult: true}) : undefined;
      });
  });

  def("ifelse", function(tf, statements1, statements2) {
    if (Type(tf) === 'list')
      tf = evaluateExpression(reparse(tf));

    return Promise.resolve(tf)
      .then(function(tf) {
        tf = aexpr(tf);
        statements1 = reparse(lexpr(statements1));
        statements2 = reparse(lexpr(statements2));

        return self.execute(tf ? statements1 : statements2, {returnResult: true});
      });
  });

  def("test", function(tf) {
    if (Type(tf) === 'list')
      tf = evaluateExpression(reparse(tf));

    return Promise.resolve(tf)
    .then(function(tf) {
      tf = aexpr(tf);
      // NOTE: A property on the scope, not within the scope
      self.scopes[self.scopes.length - 1]._test = tf;
    });
  });

  def(["iftrue", "ift"], function(statements) {
    statements = reparse(lexpr(statements));
    var tf = self.scopes[self.scopes.length - 1]._test;
    return tf ? self.execute(statements, {returnResult: true}) : undefined;
  });

  def(["iffalse", "iff"], function(statements) {
    statements = reparse(lexpr(statements));
    var tf = self.scopes[self.scopes.length - 1]._test;
    return !tf ? self.execute(statements, {returnResult: true}) : undefined;
  });

  def("stop", function() {
    throw new Output();
  });

  def(["output", "op"], function(atom) {
    throw new Output(atom);
  });

  // Not Supported: catch
  // Not Supported: throw
  // Not Supported: error
  // Not Supported: pause
  // Not Supported: continue
  // Not Supported: wait

  def("wait", function(time) {
    return new Promise(function(resolve) {
      setTimeout(resolve, aexpr(time) / 60 * 1000);
    });
  });

  def("bye", function() {
    throw new Bye;
  });

  def(".maybeoutput", function(value) {
    throw new Output(value);
  });

  // Not Supported: goto
  // Not Supported: tag

  def("ignore", function(value) {
  });

  // Not Supported: `

  def("for", function(control, statements) {
    control = reparse(lexpr(control));
    statements = reparse(lexpr(statements));

    function sign(x) { return x < 0 ? -1 : x > 0 ? 1 : 0; }

    var varname = sexpr(control.shift());
    var start, limit, step, current;

    return Promise.resolve(evaluateExpression(control))
      .then(function(r) {
        current = start = aexpr(r);
        return evaluateExpression(control);
      })
      .then(function(r) {
        limit = aexpr(r);
      })
      .then(function() {
        return promiseLoop(function(loop, resolve, reject) {
          if (sign(current - limit) === sign(step)) {
            resolve();
            return;
          }
          setvar(varname, current);
          self.execute(statements)
            .then(function() {
              return (control.length) ?
                evaluateExpression(control.slice()) : sign(limit - start);
            })
            .then(function(result) {
              step = aexpr(result);
              current += step;
            })
            .then(promiseYield)
            .then(loop, reject);
        });
      });
  });

  def("dotimes", function(control, statements) {
    control = reparse(lexpr(control));
    return self.routines.get("for")([control[0], 0, control[1]], statements);
  });

  function checkevalblock(block) {
    block = block();
    if (Type(block) === 'list') { return block; }
    throw err("{_PROC_}: Expected block");
  }

  def("do.while", function(block, tfexpression) {
    block = checkevalblock(block);
    return promiseLoop(function(loop, resolve, reject) {
      self.execute(block)
        .then(tfexpression)
        .then(function(tf) {
          if (Type(tf) === 'list')
            tf = evaluateExpression(reparse(tf));
          return tf;
        })
        .then(function(tf) {
          if (!tf) {
            resolve();
            return;
          }
          promiseYield().then(loop);
        }, reject);
    });
  }, {noeval: true});

  def("while", function(tfexpression, block) {
    block = checkevalblock(block);
    return promiseLoop(function(loop, resolve, reject) {
      Promise.resolve(tfexpression())
        .then(function(tf) {
          if (Type(tf) === 'list')
            tf = evaluateExpression(reparse(tf));
          return tf;
        })
        .then(function(tf) {
          if (!tf) {
            resolve();
            return;
          }
          self.execute(block)
            .then(promiseYield)
            .then(loop);
        }, reject);
    });
  }, {noeval: true});

  def("do.until", function(block, tfexpression) {
    block = checkevalblock(block);
    return promiseLoop(function(loop, resolve, reject) {
      self.execute(block)
        .then(tfexpression)
        .then(function(tf) {
          if (Type(tf) === 'list')
            tf = evaluateExpression(reparse(tf));
          return tf;
        })
        .then(function(tf) {
          if (tf) {
            resolve();
            return;
          }
          promiseYield().then(loop);
        }, reject);
    });
  }, {noeval: true});

  def("until", function(tfexpression, block) {
    block = checkevalblock(block);
    return promiseLoop(function(loop, resolve, reject) {
      Promise.resolve(tfexpression())
        .then(function(tf) {
          if (Type(tf) === 'list')
            tf = evaluateExpression(reparse(tf));
          return tf;
        })
        .then(function(tf) {
          if (tf) {
            resolve();
            return;
          }
          self.execute(block)
            .then(promiseYield)
            .then(loop);
        }, reject);
    });
  }, {noeval: true});

  def("case", function(value, clauses) {
    clauses = lexpr(clauses);

    for (var i = 0; i < clauses.length; ++i) {
      var clause = lexpr(clauses[i]);
      var first = clause.shift();
      if (isKeyword(first, 'ELSE')) {
        return evaluateExpression(clause);
      }
      if (lexpr(first).some(function(x) { return equal(x, value); })) {
        return evaluateExpression(clause);
      }
    }
    return undefined;
  });

  def("cond", function(clauses) {
    clauses = lexpr(clauses);
    return promiseLoop(function(loop, resolve, reject) {
      if (!clauses.length) {
        resolve();
        return;
      }
      var clause = lexpr(clauses.shift());
      var first = clause.shift();
      if (isKeyword(first, 'ELSE')) {
        resolve(evaluateExpression(clause));
        return;
      }
      evaluateExpression(reparse(lexpr(first)))
        .then(function(result) {
          if (result) {
            resolve(evaluateExpression(clause));
            return;
          }
          loop();
        }, reject);
    });
  });

  //
  // 8.2 Template-based Iteration
  //


  //
  // Higher order functions
  //

  // TODO: multiple inputs

  def("apply", function(procname, list) {
    procname = sexpr(procname);

    var routine = self.routines.get(procname);
    if (!routine)
      throw err("{_PROC_}: Don't know how to {name:U}", { name: procname });
    if (routine.special || routine.noeval)
      throw err("Can't apply {_PROC_} to special {name:U}", { name: procname });

    return routine.apply(null, lexpr(list));
  });

  def("invoke", function(procname, input1) {
    procname = sexpr(procname);

    var routine = self.routines.get(procname);
    if (!routine)
      throw err("{_PROC_}: Don't know how to {name:U}", { name: procname });
    if (routine.special || routine.noeval)
      throw err("Can't apply {_PROC_} to special {name:U}", { name: procname });

    var args = [];
    for (var i = 1; i < arguments.length; i += 1)
      args.push(arguments[i]);

    return routine.apply(null, args);
  });

  def("foreach", function(procname, list) {
    procname = sexpr(procname);

    var routine = self.routines.get(procname);
    if (!routine)
      throw err("{_PROC_}: Don't know how to {name:U}", { name: procname });
    if (routine.special || routine.noeval)
      throw err("Can't apply {_PROC_} to special {name:U}", { name: procname });
    list = lexpr(list);
    return promiseLoop(function(loop, resolve, reject) {
      if (!list.length) {
        resolve();
        return;
      }
      Promise.resolve(routine(list.shift()))
        .then(loop, reject);
    });
  });


  def("map", function(procname, list/*,  ... */) {
    procname = sexpr(procname);

    var routine = self.routines.get(procname);
    if (!routine)
      throw err("{_PROC_}: Don't know how to {name:U}", { name: procname });
    if (routine.special || routine.noeval)
      throw err("Can't apply {_PROC_} to special {name:U}", { name: procname });

    var lists = Array.prototype.slice.call(arguments, 1).map(lexpr);
    if (!lists.length)
      throw err("{_PROC_}: Expected list");

    var mapped = [];
    return promiseLoop(function(loop, resolve, reject) {
      if (!lists[0].length) {
        resolve(mapped);
        return;
      }

      var args = lists.map(function(l) {
        if (!l.length)
          throw err("{_PROC_}: Expected lists of equal length");
        return l.shift();
      });

      Promise.resolve(routine.apply(null, args))
        .then(function(value) { mapped.push(value); })
        .then(loop, reject);
    });
  });

  // Not Supported: map.se

  def("filter", function(procname, list) {
    procname = sexpr(procname);

    var routine = self.routines.get(procname);
    if (!routine)
      throw err("{_PROC_}: Don't know how to {name:U}", { name: procname });
    if (routine.special || routine.noeval)
      throw err("Can't apply {_PROC_} to special {name:U}", { name: procname });

    list = lexpr(list);
    var filtered = [];
    return promiseLoop(function(loop, resolve, reject) {
      if (!list.length) {
        resolve(filtered);
        return;
      }
      var item = list.shift();
      Promise.resolve(routine(item))
        .then(function(value) { if (value) filtered.push(item); })
        .then(loop, reject);
    });
  });

  def("find", function(procname, list) {
    procname = sexpr(procname);

    var routine = self.routines.get(procname);
    if (!routine)
      throw err("{_PROC_}: Don't know how to {name:U}", { name: procname });
    if (routine.special || routine.noeval)
      throw err("Can't apply {_PROC_} to special {name:U}", { name: procname });

    list = lexpr(list);
    return promiseLoop(function(loop, resolve, reject) {
      if (!list.length) {
        resolve([]);
        return;
      }
      var item = list.shift();
      Promise.resolve(routine(item))
        .then(function(value) {
          if (value) {
            resolve(item);
            return;
          }
          loop();
      }, reject);
    });
  });

  def("reduce", function(procname, list) {
    procname = sexpr(procname);
    list = lexpr(list);
    var value = arguments[2] !== undefined ? arguments[2] : list.shift();

    var procedure = self.routines.get(procname);
    if (!procedure)
      throw err("{_PROC_}: Don't know how to {name:U}", { name: procname });
    if (procedure.special || procedure.noeval)
      throw err("Can't apply {_PROC_} to special {name:U}", { name: procname });

    return promiseLoop(function(loop, resolve, reject) {
      if (!list.length) {
        resolve(value);
        return;
      }
      Promise.resolve(procedure(value, list.shift()))
        .then(function(result) { value = result; })
        .then(loop, reject);
    });
  });


  def("crossmap", function(procname, list/*,  ... */) {
    procname = sexpr(procname);

    var routine = self.routines.get(procname);
    if (!routine)
      throw err("{_PROC_}: Don't know how to {name:U}", { name: procname });
    if (routine.special || routine.noeval)
      throw err("Can't apply {_PROC_} to special {name:U}", { name: procname });

    var lists = Array.prototype.slice.call(arguments, 1).map(lexpr);
    if (!lists.length)
      throw err("{_PROC_}: Expected list");

    // Special case: if only one element is present, use as list of lists.
    if (lists.length === 1)
      lists = lists[0].map(lexpr);

    var indexes = lists.map(function() { return 0; });
    var done = false;

    var mapped = [];
    return promiseLoop(function(loop, resolve, reject) {
      if (done) {
        resolve(mapped);
        return;
      }

      var args = indexes.map(function(v, i) { return lists[i][v]; });

      var pos = indexes.length - 1;
      ++indexes[pos];
      while (indexes[pos] === lists[pos].length) {
        if (pos === 0) {
          done = true;
          break;
        }
        indexes[pos] = 0;
        pos--;
        ++indexes[pos];
      }

      Promise.resolve(routine.apply(null, args))
        .then(function(value) { mapped.push(value); })
        .then(loop, reject);
    });
  });

  // Not Supported: cascade
  // Not Supported: cascade.2
  // Not Supported: transfer

  // Helper for testing that wraps a result in a Promise
  def(".promise", function(value) {
    return Promise.resolve(value);
  });
}
