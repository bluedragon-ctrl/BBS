// Expression evaluator + dice roller.
//
// Authors write expressions like "2d6+INT" or "target.stats.hp < target.stats.maxHp * 0.3".
// Dice notation NdM is rolled via ctx.rng; remaining arithmetic is evaluated against ctx
// using a `with` block so `INT` resolves to ctx.INT, `target.stats.hp` to ctx.target.stats.hp,
// etc. Compiled functions are cached per (dice-substituted) expression source.

const compiledCache = new Map();

export function rollDice(n, m, rng) {
  let total = 0;
  const r = rng || Math.random;
  for (let i = 0; i < n; i++) total += Math.floor(r() * m) + 1;
  return total;
}

export function evalExpr(expr, ctx) {
  if (expr == null) return 0;
  if (typeof expr === 'number' || typeof expr === 'boolean') return expr;
  if (typeof expr !== 'string') return expr;

  // Replace NdM dice notation with calls to the __d helper.
  const transformed = expr.replace(/(\d+)\s*d\s*(\d+)/gi, '__d($1,$2)');

  let fn = compiledCache.get(transformed);
  if (!fn) {
    try {
      fn = new Function('ctx', `with(ctx){return (${transformed});}`);
    } catch (e) {
      console.warn('expr compile failed:', expr, '->', transformed, e);
      fn = () => 0;
    }
    compiledCache.set(transformed, fn);
  }

  // Augment ctx with __d helper without mutating original.
  const augmented = Object.create(ctx);
  augmented.__d = (n, m) => rollDice(n, m, ctx.rng);

  try {
    return fn(augmented);
  } catch (e) {
    console.warn('expr eval failed:', expr, '->', transformed, e);
    return 0;
  }
}
