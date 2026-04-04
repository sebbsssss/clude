import 'package:flutter_test/flutter_test.dart';

import 'package:clude_mobile/shared/utils/format_cost.dart';

void main() {
  group('formatCost', () {
    test('returns Free for zero', () {
      expect(formatCost(0), 'Free');
    });

    test('returns 5 decimals for sub-milli amounts', () {
      expect(formatCost(0.00012), '\$0.00012');
      expect(formatCost(0.0009), '\$0.00090');
    });

    test('returns 4 decimals for normal amounts', () {
      expect(formatCost(0.05), '\$0.0500');
      expect(formatCost(1.2345), '\$1.2345');
    });

    test('treats 0.001 as normal (4 decimals)', () {
      expect(formatCost(0.001), '\$0.0010');
    });
  });
}
