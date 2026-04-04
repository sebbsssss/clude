import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:clude_mobile/core/api/api_client.dart';
import 'package:clude_mobile/core/api/api_client_provider.dart';
import 'package:clude_mobile/core/api/models/chat_model.dart';
import 'package:clude_mobile/core/storage/secure_storage.dart';
import 'package:clude_mobile/core/storage/secure_storage_provider.dart';
import 'package:clude_mobile/features/chat/models_provider.dart';

class MockApiClient extends Mock implements ApiClient {}

class MockSecureStorage extends Mock implements SecureStorageService {}

const _freeModel = ChatModel(
  id: 'free-1',
  name: 'Free Model',
  privacy: 'private',
  context: 128000,
  tier: 'free',
  isDefault: true,
  cost: ModelCost(input: 0, output: 0),
);

const _proModel = ChatModel(
  id: 'pro-1',
  name: 'Pro Model',
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

  ProviderContainer createContainer() {
    return ProviderContainer(
      overrides: [
        apiClientProvider.overrideWithValue(mockClient),
        secureStorageProvider.overrideWithValue(mockStorage),
      ],
    );
  }

  group('ModelsNotifier', () {
    test('fetchModels fetches from API and sets state', () async {
      when(() => mockClient.getModels())
          .thenAnswer((_) async => [_freeModel, _proModel]);

      final container = createContainer();
      addTearDown(container.dispose);

      final notifier = container.read(modelsNotifierProvider.notifier);
      final result = await notifier.fetchModels();

      expect(result.length, 2);
      expect(container.read(modelsNotifierProvider).value, isNotNull);
      verify(() => mockClient.getModels()).called(1);
    });

    test('fetchModels returns cache within 60s TTL', () async {
      when(() => mockClient.getModels())
          .thenAnswer((_) async => [_freeModel]);

      final container = createContainer();
      addTearDown(container.dispose);

      final notifier = container.read(modelsNotifierProvider.notifier);
      await notifier.fetchModels();
      await notifier.fetchModels();

      // Only one API call despite two fetchModels calls.
      verify(() => mockClient.getModels()).called(1);
    });

    test('fetchModels clears cache on error to allow retry', () async {
      when(() => mockClient.getModels()).thenThrow(Exception('fail'));

      final container = createContainer();
      addTearDown(container.dispose);

      final notifier = container.read(modelsNotifierProvider.notifier);

      await expectLater(notifier.fetchModels(), throwsA(isA<Exception>()));
      expect(container.read(modelsNotifierProvider), isA<AsyncError>());

      // Second call should re-attempt API (cache was cleared).
      when(() => mockClient.getModels())
          .thenAnswer((_) async => [_freeModel]);
      final result = await notifier.fetchModels();

      expect(result.length, 1);
      verify(() => mockClient.getModels()).called(2);
    });
  });

  group('SelectedModelNotifier', () {
    test('selectModel persists to storage and updates state', () async {
      final container = createContainer();
      addTearDown(container.dispose);

      final notifier = container.read(selectedModelNotifierProvider.notifier);
      await notifier.selectModel('pro-1');

      expect(container.read(selectedModelNotifierProvider), 'pro-1');
      verify(() => mockStorage.setSelectedModel('pro-1')).called(1);
    });

    test('resolveDefault picks isDefault model when no selection', () async {
      final container = createContainer();
      addTearDown(container.dispose);

      final notifier = container.read(selectedModelNotifierProvider.notifier);
      notifier.resolveDefault([_freeModel, _proModel]);

      await pumpEventQueue();
      expect(container.read(selectedModelNotifierProvider), 'free-1');
    });

    test('resolveDefault picks first model when no default flag', () async {
      const noDefault = ChatModel(
        id: 'nd-1',
        name: 'No Default',
        privacy: 'private',
        context: 128000,
        tier: 'free',
        cost: ModelCost(input: 0, output: 0),
      );

      final container = createContainer();
      addTearDown(container.dispose);

      final notifier = container.read(selectedModelNotifierProvider.notifier);
      notifier.resolveDefault([noDefault, _proModel]);

      await pumpEventQueue();
      expect(container.read(selectedModelNotifierProvider), 'nd-1');
    });

    test('resolveDefault is no-op when selection exists in models', () async {
      final container = createContainer();
      addTearDown(container.dispose);

      final notifier = container.read(selectedModelNotifierProvider.notifier);
      await notifier.selectModel('pro-1');

      notifier.resolveDefault([_freeModel, _proModel]);

      expect(container.read(selectedModelNotifierProvider), 'pro-1');
    });

    test('resolveDefault re-resolves when stored model not in list', () async {
      final container = createContainer();
      addTearDown(container.dispose);

      final notifier = container.read(selectedModelNotifierProvider.notifier);
      await notifier.selectModel('deleted-model');

      notifier.resolveDefault([_freeModel, _proModel]);

      await pumpEventQueue();
      expect(container.read(selectedModelNotifierProvider), 'free-1');
    });

    test('downgradeIfPro switches to free when current is pro', () async {
      final container = createContainer();
      addTearDown(container.dispose);

      final notifier = container.read(selectedModelNotifierProvider.notifier);
      await notifier.selectModel('pro-1');

      notifier.downgradeIfPro([_freeModel, _proModel]);

      await pumpEventQueue();
      expect(container.read(selectedModelNotifierProvider), 'free-1');
    });

    test('downgradeIfPro is no-op when current is free', () async {
      final container = createContainer();
      addTearDown(container.dispose);

      final notifier = container.read(selectedModelNotifierProvider.notifier);
      await notifier.selectModel('free-1');
      clearInteractions(mockStorage);

      notifier.downgradeIfPro([_freeModel, _proModel]);

      expect(container.read(selectedModelNotifierProvider), 'free-1');
      verifyNever(() => mockStorage.setSelectedModel(any()));
    });
  });
}
