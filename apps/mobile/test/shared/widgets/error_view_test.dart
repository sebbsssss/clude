import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:clude_mobile/shared/widgets/error_view.dart';

void main() {
  group('ErrorView', () {
    testWidgets('renders icon and message', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: ErrorView(message: 'Something went wrong'),
          ),
        ),
      );

      expect(find.byIcon(Icons.error_outline), findsOneWidget);
      expect(find.text('Something went wrong'), findsOneWidget);
    });

    testWidgets('renders custom icon', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: ErrorView(
              message: 'Oops',
              icon: Icons.cloud_off,
            ),
          ),
        ),
      );

      expect(find.byIcon(Icons.cloud_off), findsOneWidget);
    });

    testWidgets('shows Retry button when onRetry is provided', (tester) async {
      var retried = false;

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ErrorView(
              message: 'Failed',
              onRetry: () => retried = true,
            ),
          ),
        ),
      );

      expect(find.text('Retry'), findsOneWidget);

      await tester.tap(find.text('Retry'));
      expect(retried, isTrue);
    });

    testWidgets('hides Retry button when onRetry is null', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: ErrorView(message: 'Read-only error'),
          ),
        ),
      );

      expect(find.text('Retry'), findsNothing);
    });
  });
}
