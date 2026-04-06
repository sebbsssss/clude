import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/models/entity_data.dart';
import '../../shared/utils/relative_time.dart';
import 'entities_provider.dart';

class _EntityTypeConfig {
  const _EntityTypeConfig(this.color, this.icon, this.label);
  final Color color;
  final IconData icon;
  final String label;
}

const _entityTypeConfig = <String, _EntityTypeConfig>{
  'person': _EntityTypeConfig(Color(0xFF4466FF), Icons.person, 'People'),
  'project': _EntityTypeConfig(Color(0xFF34D399), Icons.folder, 'Projects'),
  'concept': _EntityTypeConfig(Color(0xFFA78BFA), Icons.lightbulb, 'Concepts'),
  'token': _EntityTypeConfig(Color(0xFFFBBF24), Icons.toll, 'Tokens'),
  'wallet': _EntityTypeConfig(
      Color(0xFFEF4444), Icons.account_balance_wallet, 'Wallets'),
  'location': _EntityTypeConfig(Color(0xFF06B6D4), Icons.place, 'Locations'),
  'event': _EntityTypeConfig(Color(0xFFEC4899), Icons.event, 'Events'),
};

const _typeOrder = [
  'person',
  'project',
  'concept',
  'token',
  'wallet',
  'location',
  'event',
];

class EntitiesTab extends ConsumerStatefulWidget {
  const EntitiesTab({super.key});

  @override
  ConsumerState<EntitiesTab> createState() => _EntitiesTabState();
}

class _EntitiesTabState extends ConsumerState<EntitiesTab> {
  final _searchController = TextEditingController();
  String _query = '';
  Timer? _debounce;

  @override
  void dispose() {
    _searchController.dispose();
    _debounce?.cancel();
    super.dispose();
  }

  void _onSearchChanged(String value) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 300), () {
      setState(() => _query = value.trim());
    });
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.all(12),
          child: TextField(
            controller: _searchController,
            onChanged: _onSearchChanged,
            decoration: const InputDecoration(
              hintText: 'Search entities...',
              prefixIcon: Icon(Icons.search),
              border: OutlineInputBorder(),
              isDense: true,
            ),
          ),
        ),
        Expanded(
          child: _query.isEmpty
              ? _buildGroupedList()
              : _buildSearchResults(),
        ),
      ],
    );
  }

  Widget _buildGroupedList() {
    final asyncEntities = ref.watch(entitiesProvider);

    return asyncEntities.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (error, _) => Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(error.toString(), textAlign: TextAlign.center),
            const SizedBox(height: 8),
            ElevatedButton(
              onPressed: () => ref.invalidate(entitiesProvider),
              child: const Text('Retry'),
            ),
          ],
        ),
      ),
      data: (entities) {
        if (entities.isEmpty) {
          return const Center(child: Text('No entities yet'));
        }

        // Group by type
        final grouped = <String, List<GraphEntity>>{};
        for (final e in entities) {
          grouped.putIfAbsent(e.type, () => []).add(e);
        }

        final sections = _typeOrder
            .where((t) => grouped.containsKey(t) && grouped[t]!.isNotEmpty)
            .toList();

        return ListView.builder(
          itemCount: sections.length,
          itemBuilder: (context, index) {
            final type = sections[index];
            final items = grouped[type]!;
            final config =
                _entityTypeConfig[type] ?? _EntityTypeConfig(Colors.grey, Icons.label, type);

            return ExpansionTile(
              initiallyExpanded: true,
              leading: Icon(config.icon, color: config.color, size: 20),
              title: Text(
                config.label,
                style: TextStyle(
                  color: config.color,
                  fontWeight: FontWeight.w600,
                ),
              ),
              trailing: Text('${items.length}',
                  style: Theme.of(context).textTheme.bodySmall),
              children: items
                  .map((e) => _EntityRow(entity: e, onTap: () => _showDetail(e.id)))
                  .toList(),
            );
          },
        );
      },
    );
  }

  Widget _buildSearchResults() {
    final asyncResults = ref.watch(entitySearchProvider(_query));

    return asyncResults.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (error, _) => Center(child: Text(error.toString())),
      data: (results) {
        if (results.isEmpty) {
          return const Center(child: Text('No entities matching'));
        }
        return ListView.builder(
          itemCount: results.length,
          itemBuilder: (context, index) => _EntityRow(
            entity: results[index],
            onTap: () => _showDetail(results[index].id),
          ),
        );
      },
    );
  }

  void _showDetail(int entityId) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (_) => DraggableScrollableSheet(
        initialChildSize: 0.5,
        maxChildSize: 0.85,
        expand: false,
        builder: (context, scrollController) => _EntityDetailSheet(
          entityId: entityId,
          scrollController: scrollController,
        ),
      ),
    );
  }
}

class _EntityRow extends StatelessWidget {
  const _EntityRow({required this.entity, required this.onTap});
  final GraphEntity entity;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final config = _entityTypeConfig[entity.type];
    return ListTile(
      onTap: onTap,
      leading: config != null
          ? Icon(config.icon, color: config.color, size: 18)
          : null,
      title: Text(entity.name, maxLines: 1, overflow: TextOverflow.ellipsis),
      subtitle: Text(
        '${entity.mentionCount} mentions'
        '${entity.lastSeen != null ? ' · ${relativeTime(entity.lastSeen!)}' : ''}',
        style: Theme.of(context).textTheme.bodySmall,
      ),
      trailing: const Icon(Icons.chevron_right, size: 18),
    );
  }
}

class _EntityDetailSheet extends ConsumerWidget {
  const _EntityDetailSheet({
    required this.entityId,
    required this.scrollController,
  });
  final int entityId;
  final ScrollController scrollController;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final asyncDetail = ref.watch(entityDetailProvider(entityId));

    return asyncDetail.when(
      loading: () =>
          const Center(child: Padding(padding: EdgeInsets.all(32), child: CircularProgressIndicator())),
      error: (error, _) => Center(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Text(error.toString()),
        ),
      ),
      data: (detail) {
        final entity = detail.entity;
        final config = _entityTypeConfig[entity.type];
        final color = config?.color ?? Colors.grey;

        return ListView(
          controller: scrollController,
          padding: const EdgeInsets.all(16),
          children: [
            // Entity header
            Row(
              children: [
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                    color: color.withAlpha(38),
                    borderRadius: BorderRadius.circular(4),
                    border: Border.all(color: color.withAlpha(100)),
                  ),
                  child: Text(
                    entity.type.toUpperCase(),
                    style: TextStyle(
                        fontSize: 11,
                        color: color,
                        fontWeight: FontWeight.w600),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(entity.name,
                      style: Theme.of(context).textTheme.titleMedium),
                ),
              ],
            ),
            if (entity.description.isNotEmpty) ...[
              const SizedBox(height: 8),
              Text(entity.description),
            ],
            const SizedBox(height: 8),
            Text('${entity.mentionCount} mentions',
                style: Theme.of(context).textTheme.bodySmall),

            // Related memories
            if (detail.memories.isNotEmpty) ...[
              const Divider(height: 24),
              Text('Related Memories',
                  style: Theme.of(context).textTheme.titleSmall),
              const SizedBox(height: 8),
              ...detail.memories.map((m) => ListTile(
                    dense: true,
                    contentPadding: EdgeInsets.zero,
                    title: Text(m.summary,
                        maxLines: 2, overflow: TextOverflow.ellipsis),
                    subtitle: Text(relativeTime(m.createdAt)),
                  )),
            ],

            // Related entities
            if (detail.relatedEntities.isNotEmpty) ...[
              const Divider(height: 24),
              Text('Linked Entities',
                  style: Theme.of(context).textTheme.titleSmall),
              const SizedBox(height: 8),
              Wrap(
                spacing: 6,
                runSpacing: 6,
                children: detail.relatedEntities
                    .map((r) => Chip(
                          label: Text('Entity #${r.entityId}'),
                          visualDensity: VisualDensity.compact,
                        ))
                    .toList(),
              ),
            ],
          ],
        );
      },
    );
  }
}
