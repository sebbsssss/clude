import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:clude_mobile/core/storage/secure_storage.dart';
import 'package:clude_mobile/core/storage/secure_storage_provider.dart';
import 'package:clude_mobile/features/byok/byok_provider.dart';
import 'package:clude_mobile/features/byok/byok_screen.dart';

class MockSecureStorage extends Mock implements SecureStorageService {}

void main() {
  late MockSecureStorage mockStorage;

  setUp(() {
    mockStorage = MockSecureStorage();
    for (final p in byokProviders) {
      when(() => mockStorage.getByokKey(p)).thenAnswer((_) async => null);
    }
  });

  Widget buildApp() {
    return ProviderScope(
      overrides: [
        secureStorageProvider.overrideWithValue(mockStorage),
        byokKeysNotifierProvider.overrideWith((ref) {
          final notifier = ByokKeysNotifier(ref);
          // Wait for loadKeys then override state
          return notifier;
        }),
      ],
      child: const MaterialApp(home: ByokScreen()),
    );
  }

  group('ByokScreen', () {
    testWidgets('shows all 6 providers', (tester) async {
      await tester.pumpWidget(buildApp());
      await tester.pumpAndSettle();

      expect(find.text('Anthropic'), findsOneWidget);
      expect(find.text('OpenAI'), findsOneWidget);
      expect(find.text('Google AI'), findsOneWidget);
      expect(find.text('xAI'), findsOneWidget);
      expect(find.text('DeepSeek'), findsOneWidget);
      expect(find.text('MiniMax'), findsOneWidget);
    });

    testWidgets('shows configured count', (tester) async {
      await tester.pumpWidget(buildApp());
      await tester.pumpAndSettle();

      expect(find.text('0 of 6 providers configured'), findsOneWidget);
    });

    testWidgets('shows Add button for unconfigured provider', (tester) async {
      await tester.pumpWidget(buildApp());
      await tester.pumpAndSettle();

      expect(find.text('Add'), findsNWidgets(6));
    });

    testWidgets('tapping Add shows key entry dialog', (tester) async {
      await tester.pumpWidget(buildApp());
      await tester.pumpAndSettle();

      await tester.tap(find.text('Add').first);
      await tester.pumpAndSettle();

      expect(find.text('Add Anthropic Key'), findsOneWidget);
      expect(find.text('Save'), findsOneWidget);
      expect(find.text('Cancel'), findsOneWidget);
      expect(find.text('Get your API key →'), findsOneWidget);
    });

    testWidgets('validation rejects invalid key prefix', (tester) async {
      await tester.pumpWidget(buildApp());
      await tester.pumpAndSettle();

      await tester.tap(find.text('Add').first);
      await tester.pumpAndSettle();

      await tester.enterText(find.byType(TextField), 'wrong-key');
      await tester.tap(find.text('Save'));
      await tester.pumpAndSettle();

      expect(find.textContaining('should start with'), findsOneWidget);
    });

    testWidgets('saves valid key and closes dialog', (tester) async {
      when(() => mockStorage.setByokKey('anthropic', 'sk-ant-test123'))
          .thenAnswer((_) async {});

      await tester.pumpWidget(buildApp());
      await tester.pumpAndSettle();

      await tester.tap(find.text('Add').first);
      await tester.pumpAndSettle();

      await tester.enterText(find.byType(TextField), 'sk-ant-test123');
      await tester.tap(find.text('Save'));
      await tester.pumpAndSettle();

      // Dialog should be closed
      expect(find.text('Add Anthropic Key'), findsNothing);
    });
  });
}
