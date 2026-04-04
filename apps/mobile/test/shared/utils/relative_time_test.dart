import 'package:flutter_test/flutter_test.dart';
import 'package:clude_mobile/shared/utils/relative_time.dart';

void main() {
  group('relativeTime', () {
    String ago(Duration duration) {
      return DateTime.now().subtract(duration).toUtc().toIso8601String();
    }

    test('returns empty string for invalid input', () {
      expect(relativeTime('not-a-date'), '');
      expect(relativeTime(''), '');
    });

    test('returns Just now for less than 1 minute', () {
      expect(relativeTime(ago(const Duration(seconds: 30))), 'Just now');
      expect(relativeTime(ago(Duration.zero)), 'Just now');
    });

    test('returns minutes ago for less than 1 hour', () {
      expect(relativeTime(ago(const Duration(minutes: 5))), '5m ago');
      expect(relativeTime(ago(const Duration(minutes: 59))), '59m ago');
    });

    test('returns hours ago for less than 24 hours', () {
      expect(relativeTime(ago(const Duration(hours: 2))), '2h ago');
      expect(relativeTime(ago(const Duration(hours: 23))), '23h ago');
    });

    test('returns days ago for less than 30 days', () {
      expect(relativeTime(ago(const Duration(days: 1))), '1d ago');
      expect(relativeTime(ago(const Duration(days: 29))), '29d ago');
    });

    test('returns month and day for 30+ days', () {
      final old = DateTime.utc(2025, 3, 15, 12).toIso8601String();
      expect(relativeTime(old), 'Mar 15');
    });
  });
}
