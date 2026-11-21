const assert = require('node:assert/strict');
const test = require('node:test');
const invoice = require('../lib/invoice');
const orders = require('../lib/orders');
const pricing = require('../lib/pricing');

function recordOrder(items, coupon = '') {
  const db = { nextOrderId: 1001, orders: [] };
  const billed = pricing.computeTotals(items, coupon);
  const order = orders.add(db, { date: '2021-11-30', items, coupon, ...billed });
  return { billed, order };
}

function amounts({ subtotal, discount, tax, cgst, sgst, total }) {
  return { subtotal, discount, tax, cgst, sgst, total };
}

test('invoice matches an undiscounted order billed at 18% GST', () => {
  const { billed, order } = recordOrder([
    { name: 'Tea', hsn: '0902', price: 80, qty: 2 }
  ]);
  const expected = { subtotal: 160, discount: 0, tax: 28.8, cgst: 14.4, sgst: 14.4, total: 188.8 };
  assert.deepEqual(amounts(billed), expected);
  assert.deepEqual(amounts(invoice.computeInvoiceFigures(order)), expected);
  const html = invoice.render(order);
  assert.ok(html.includes('<td>Invoice Total</td><td class="r">₹188.80</td>'));
  assert.doesNotMatch(html, /Accountant Reconciliation Notice/);
});

test('printable invoice matches the billed total and GST for mixed HSN rates', () => {
  const { order } = recordOrder([
    { name: 'Rice', hsn: '1006', price: 100, qty: 2 },
    { name: 'Ghee', hsn: '0405', price: 100, qty: 1 },
    { name: 'Tea', hsn: '0902', price: 100, qty: 1 }
  ]);
  assert.equal(order.total, 440);
  assert.equal(order.tax, 40);

  const figures = invoice.computeInvoiceFigures(order);
  assert.equal(figures.total, order.total, 'invoice total must match the recorded charge');
  assert.deepEqual(amounts(figures), {
    subtotal: 400, discount: 0, tax: 40, cgst: 20, sgst: 20, total: 440
  });
  assert.deepEqual(figures.rows.map(({ gstPercent, lineTax }) => [gstPercent, lineTax]), [
    [5, 10], [12, 12], [18, 18]
  ]);

  const html = invoice.render(order);
  assert.ok(html.includes('<td>CGST + SGST (Total GST)</td><td class="r">₹40.00</td>'));
  assert.ok(html.includes('<td>Invoice Total</td><td class="r">₹440.00</td>'));
  assert.doesNotMatch(html, /Accountant Reconciliation Notice/);
});

test('invoice applies a flat coupon before calculating GST', () => {
  const { billed, order } = recordOrder([
    { name: 'Tea', hsn: '0902', price: 300, qty: 1 }
  ], 'FLAT50');
  assert.deepEqual(amounts(billed), {
    subtotal: 300, discount: 50, tax: 45, cgst: 22.5, sgst: 22.5, total: 295
  });
  assert.deepEqual(amounts(invoice.computeInvoiceFigures(order)), {
    subtotal: 300, discount: 50, tax: 45, cgst: 22.5, sgst: 22.5, total: 295
  });
});

test('invoice applies the percentage coupon cap before calculating GST', () => {
  const { billed, order } = recordOrder([
    { name: 'Tea', hsn: '0902', price: 1000, qty: 2 }
  ], 'SAVE10');
  assert.deepEqual(amounts(billed), {
    subtotal: 2000, discount: 150, tax: 333, cgst: 166.5, sgst: 166.5, total: 2183
  });
  assert.deepEqual(amounts(invoice.computeInvoiceFigures(order)), {
    subtotal: 2000, discount: 150, tax: 333, cgst: 166.5, sgst: 166.5, total: 2183
  });
  assert.doesNotMatch(invoice.render(order), /Accountant Reconciliation Notice/);
});

test('invoice excludes expired coupons from stored orders with no billed discount', () => {
  const order = {
    items: [{ name: 'Tea', hsn: '0902', price: 1000, qty: 1 }],
    coupon: 'DIWALI20',
    subtotal: 1000,
    discount: 0,
    tax: 180,
    total: 1180
  };
  assert.deepEqual(amounts(invoice.computeInvoiceFigures(order)), {
    subtotal: 1000, discount: 0, tax: 180, cgst: 90, sgst: 90, total: 1180
  });
});

test('invoice handles percentage, decimal, and zero GST rates like billing', () => {
  const { billed, order } = recordOrder([
    { name: 'Tea', gstRate: 12, price: 100, qty: 1 },
    { name: 'Rice', gstRate: 0.05, price: 100, qty: 1 },
    { name: 'Grain', gstRate: 0, price: 100, qty: 1 }
  ]);
  assert.deepEqual(billed.lines.map(({ gstPercent, tax }) => [gstPercent, tax]), [
    [12, 12], [5, 5], [0, 0]
  ]);
  const figures = invoice.computeInvoiceFigures(order);
  assert.deepEqual(figures.rows.map(({ gstPercent, lineTax }) => [gstPercent, lineTax]), [
    [12, 12], [5, 5], [0, 0]
  ]);
  assert.equal(order.total, 317);
  assert.equal(figures.total, 317);
});

test('invoice GST sums the same rounded line amounts as billing', () => {
  const { billed, order } = recordOrder([
    { name: 'Tea', price: 0.03, qty: 1 },
    { name: 'Coffee', price: 0.03, qty: 1 }
  ]);
  assert.deepEqual(amounts(billed), {
    subtotal: 0.06, discount: 0, tax: 0.02, cgst: 0.01, sgst: 0.01, total: 0.08
  });
  const figures = invoice.computeInvoiceFigures(order);
  assert.deepEqual(figures.rows.map(({ lineTax }) => lineTax), [0.01, 0.01]);
  assert.deepEqual(amounts(figures), {
    subtotal: 0.06, discount: 0, tax: 0.02, cgst: 0.01, sgst: 0.01, total: 0.08
  });
  assert.doesNotMatch(invoice.render(order), /Accountant Reconciliation Notice/);
});
