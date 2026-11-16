import SnowflakePane, { PostgresPane } from './sf_pg/sf_pg_pane';
import S3Pane from './s3/S3Pane';
import IndexHealth from './indexer';
import StreamsetsPane from './streamsets/StreamsetsPane';
import DataShuttle from './DataShuttle';

import sfIcon from "/icons/snowflake_badge.svg";
import s3Icon from "/icons/s3_badge.svg";
import pgIcon from "/icons/postgres_badge.svg";
import ssIcon from "/streamsets_badge.png";
import shuttleIcon from "/icons/JJ_Icon_Refresh_RGB.svg";

// The tabs across the top of Data Studio, in the order they show.
//
// To add a pane: build it in its own folder, then add a line here.
//   id         - goes in the URL as ?pane=<id>, keep it short and stable
//   permission - the tab is hidden when the user lacks it. Add the key to
//                ALL_PERMISSIONS (and PERMISSION_PARENTS) in backend/auth.py, the
//                Data Studio group in userManagement/access.js and the role
//                defaults in RBACContext.jsx
//   component  - gets { logInPage, active } as props
//
// The dashboard card's shortcuts and the breadcrumb live in config/tools.js
// (Data Studio's sections and trail) - add the new pane there too.
export const PANES = [
  { id: 'snowflake', label: 'Snowflake',   icon: sfIcon, component: SnowflakePane, permission: 'runSnowflakeQueryRunner' },
  { id: 'postgres',  label: 'Postgres',    icon: pgIcon, component: PostgresPane, permission: 'runPostgresStudio' },
  { id: 'indexer',   label: 'Index Health', icon: pgIcon, component: IndexHealth, permission: 'viewPGindexer' },
  { id: 's3',        label: 'S3 Explorer', icon: s3Icon, component: S3Pane, permission: 'runS3Explorer' },
  { id: 'streamsets', label: 'StreamSets Extractor', icon: ssIcon, component: StreamsetsPane, permission: 'runStreamsetsExtractor' },
  { id: 'shuttle',   label: 'Data Shuttle', icon: shuttleIcon, component: DataShuttle, permission: 'runDataShuttle' },
];