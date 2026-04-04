import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:clude_mobile/core/api/api_client.dart';
import 'package:clude_mobile/core/api/api_client_provider.dart';
import 'package:clude_mobile/core/api/models/chat_model.dart';
import 'package:clude_mobile/core/auth/auth_notifier.dart';
import 'package:clude_mobile/core/auth/auth_provider.dart';
import 'package:clude_mobile/core/auth/auth_state.dart';
import 'package:clude_mobile/core/storage/secure_storage.dart';
import 'package:clude_mobile/core/storage/secure_storage_provider.dart';
import 'package:clude_mobile/features/chat/widgets/model_selector_sheet.dart';

class MockApiClient extends Mock implements ApiClient {}

class MockSecureStorage extends Mock implements SecureStorageService {}

class MockAuthNotifier extends StateNotifier<AuthState>
    with Mock
    implements AuthNotifier {
  MockAuthNotifier(super.state);
}

const _freePrivate = ChatModel(
  id: 'free-1',
  name: 'Free Private',
  privacy: 'private',
  context: 128000,
  tier: 'free',
  isDefault: true,
  cost: ModelCost(input: 0, output: 0),
);

const _proAnon = ChatModel(
  id: 'pro-1',
  name: 'Pro Anonymized',
  privacy: 'anonymized',
  context: 200000,
  tier: 'pro',
  cost: ModelCost(input: 3.0, output: 15.0),
);

void main() {
  late MockApiClient mockClient;
  late MockSecureStorage mockStorage;

  setUp(() {
    mockClient = MockApiClient();
    mockStorage = MockSecureStorage();
    when(() => mockStorage.getSelectedModel()).thenAnswer((_) async => null);
    when(() => mockStorage.setSelectedModel(any())).thenAnswer((_) async {});
  });

  Widget buildSubject({bool isAuthenticated = true}) {
    return ProviderScope(
      overrides: [
        apiClientProvider.overrideWithValue(mockClient),
        secureStorageProvider.overrideWithValue(mockStorage),
        authNotifierProvider.overrideWith(
          (ref) => MockAuthNotifier(
            AuthState(isAuthenticated: isAuthenticated),
          ),
        ),
      ],
      child: MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) => ElevatedButton(
              onPressed: () => showModalBottomSheet(
                context: context,
                isScrollControlled: true,
                builder: (_) => const SizedBox(
                  height: 500,
                  child: ModelSelectorSheet(),
                ),
              ),
              child: const Text('Open'),
            ),
          ),
        ),
      ),
    );
  }

  group('ModelSelectorSheet', () {
    testWidgets('shows privacy-grouped models', (tester) async {
      when(() => mockClient.getModels())
          .thenAnswer((_) async => [_freePrivate, _proAnon]);

      await tester.pumpWidget(buildSubject());
      await tester.tap(find.text('Open'));
      await tester.pumpAndSettle();

      expect(find.text('Choose Model'), findsOneWidget);
      expect(
          find.text('Private — Zero Data Retention'), findsOneWidget);
      expect(find.text('Anonymized — No Identity Attached'),
          findsOneWidget);
      expect(find.text('Free Private'), findsOneWidget);
      expect(find.text('Pro Anonymized'), findsOneWidget);
    });

    testWidgets('shows context and cost for each model', (tester) async {
      when(() => mockClient.getModels())
          .thenAnswer((_) async => [_freePrivate, _proAnon]);

      await tester.pumpWidget(buildSubject());
      await tester.tap(find.text('Open'));
      await tester.pumpAndSettle();

      expect(find.text('128K ctx · Free'), findsOneWidget);
      // (3.0 + 15.0) * 0.0005 = 0.0090
      expect(find.text('200K ctx · ~\$0.0090/msg'), findsOneWidget);
    });

    testWidgets('shows lock icon for pro model when unauthenticated',
        (tester) async {
      when(() => mockClient.getModels())
          .thenAnswer((_) async => [_freePrivate, _proAnon]);

      await tester.pumpWidget(buildSubject(isAuthenticated: false));
      await tester.tap(find.text('Open'));
      await tester.pumpAndSettle();

      expect(find.byIcon(Icons.lock_outline), findsOneWidget);
    });

    testWidgets('no lock icon when authenticated', (tester) async {
      when(() => mockClient.getModels())
          .thenAnswer((_) async => [_freePrivate, _proAnon]);

      await tester.pumpWidget(buildSubject(isAuthenticated: true));
      await tester.tap(find.text('Open'));
      await tester.pumpAndSettle();

      expect(find.byIcon(Icons.lock_outline), findsNothing);
    });

    testWidgets('shows error state with retry on fetch failure',
        (tester) async {
      when(() => mockClient.getModels())
          .thenAnswer((_) async => throw Exception('fail'));

      await tester.pumpWidget(buildSubject());
      await tester.tap(find.text('Open'));
      // Allow async fetchModels to fail and rebuild.
      await tester.pump();
      await tester.pump();
      await tester.pump();

      expect(find.text('Failed to load models'), findsOneWidget);
      expect(find.text('Retry'), findsOneWidget);
    });

    testWidgets('selecting a model updates provider and closes sheet',
        (tester) async {
      when(() => mockClient.getModels())
          .thenAnswer((_) async => [_freePrivate, _proAnon]);

      await tester.pumpWidget(buildSubject());
      await tester.tap(find.text('Open'));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Pro Anonymized'));
      await tester.pumpAndSettle();

      // Sheet should be closed.
      expect(find.text('Choose Model'), findsNothing);
      verify(() => mockStorage.setSelectedModel('pro-1')).called(1);
    });
  });
}
