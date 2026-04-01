import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:clude_mobile/core/connectivity/connectivity_provider.dart';
import 'package:clude_mobile/shared/widgets/offline_banner.dart';

void main() {
  group('OfflineBanner', () {
    testWidgets('shows banner when offline', (tester) async {
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            connectivityStreamProvider.overrideWith(
              (ref) => Stream.value(ConnectivityStatus.offline),
            ),
          ],
          child: const MaterialApp(
            home: Scaffold(
              body: Column(
                children: [
                  OfflineBanner(),
                  Expanded(child: Placeholder()),
                ],
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('No internet connection'), findsOneWidget);
      expect(find.byIcon(Icons.wifi_off), findsOneWidget);
    });

    testWidgets('hides banner when online', (tester) async {
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            connectivityStreamProvider.overrideWith(
              (ref) => Stream.value(ConnectivityStatus.online),
            ),
          ],
          child: const MaterialApp(
            home: Scaffold(
              body: Column(
                children: [
                  OfflineBanner(),
                  Expanded(child: Placeholder()),
                ],
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('No internet connection'), findsNothing);
    });

    testWidgets('renders SizedBox.shrink while loading', (tester) async {
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            connectivityStreamProvider.overrideWith(
              (ref) => const Stream<ConnectivityStatus>.empty(),
            ),
          ],
          child: const MaterialApp(
            home: Scaffold(
              body: Column(
                children: [
                  OfflineBanner(),
                  Expanded(child: Placeholder()),
                ],
              ),
            ),
          ),
        ),
      );
      await tester.pump();

      expect(find.text('No internet connection'), findsNothing);
    });
  });
}
