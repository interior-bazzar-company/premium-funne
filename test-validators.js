var src = require("fs").readFileSync("script.js", "utf8");
// pull the validator block out of the IIFE and eval it standalone
var start = src.indexOf("function digits(v)");
var end = src.indexOf("function valid(step)");
eval(src.slice(start, end));
var a = require("assert");

// phone: good
["9876543211","+91 98765 43211","09876543211","6123456780","98765 43211"]
  .forEach(function(v){ a.ok(phoneOk(v), "should pass: " + v); });
// phone: junk
["1234","1234567890","5876543211","987654321","9999999999","9876543210","6789012345","abcdefghij",""]
  .forEach(function(v){ a.ok(!phoneOk(v), "should fail: " + v); });

// names: good
["Vishal","Vishal Shakya","R. Sharma","O'Brien","Rene Dsouza","Jo Ann"]
  .forEach(function(v){ a.ok(nameOk(v), "name should pass: " + v); });
// names: junk
["asdf","qwerty","zxcv","hjkl","sdfgh","aaaa","...","1234","V","x@y","Vishal123",""]
  .forEach(function(v){ a.ok(!nameOk(v), "name should fail: " + v); });

// business: good
["3D Interiors","S&K Decor","Sharma Interiors Pvt. Ltd.","Ab Design"]
  .forEach(function(v){ a.ok(bizOk(v), "biz should pass: " + v); });
// business: junk
["asdf","123","qwertyui","####","zzzz",""]
  .forEach(function(v){ a.ok(!bizOk(v), "biz should fail: " + v); });

// city: good
["Delhi","New Delhi","Bengaluru","Thiruvananthapuram","Navi-Mumbai"]
  .forEach(function(v){ a.ok(cityOk(v), "city should pass: " + v); });
// city: junk
["asdf","qwe","123","Delhi1","xyz","mmm",""]
  .forEach(function(v){ a.ok(!cityOk(v), "city should fail: " + v); });

// email
["a@b.co","vishal.s@interiorbazzar.com"].forEach(function(v){ a.ok(emailOk(v), v); });
["a@b","ab.co","a b@c.com","@b.co",""].forEach(function(v){ a.ok(!emailOk(v), v); });

console.log("all validator checks passed");
